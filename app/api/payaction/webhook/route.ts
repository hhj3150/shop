import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookAuth } from "@/lib/payaction";
import { sendOrphanDepositAlert } from "@/lib/orphan-alert";

// PayAction(페이액션) 매칭완료 웹훅 수신.
//
// 보안 설계:
//   1) x-webhook-key / x-mall-id 를 환경값과 대조해 PayAction 요청만 통과(verifyWebhookAuth).
//   2) DB 입금확인은 SECURITY DEFINER RPC(payaction_confirm)가 수행하며,
//      Vault 공유 시크릿(CONFIRM_PAYMENT_SECRET)으로 호출자를 한 번 더 검증한다(service_role 미사용).
//   3) x-trace-id 를 PK 로 저장해 동일 웹훅 재전송을 멱등 처리한다.
//   4) 입금확인 문자는 PayAction 이 직접 발송하므로 여기서는 보내지 않는다.
//
// 응답 규약: 검증 통과 시 항상 200 {status:"success"} 를 반환한다(주문없음/중복 등 비-재시도 사유 포함).
//   일시적 DB 오류만 5xx 로 응답해 PayAction 재전송(최대 3회)을 받는다.
//
// 환경변수(서버 전용, 절대 커밋 금지): PAYACTION_WEBHOOK_KEY, PAYACTION_MALL_ID, CONFIRM_PAYMENT_SECRET.

export const runtime = "nodejs";

export async function POST(req: Request) {
  const confirmSecret = process.env.CONFIRM_PAYMENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!confirmSecret || !supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ status: "error", reason: "not_configured" }, { status: 503 });
  }

  // 1) 헤더 인증. 키/상점ID 불일치는 외부 요청 → 401.
  const webhookKey = req.headers.get("x-webhook-key");
  const mallId = req.headers.get("x-mall-id");
  if (!verifyWebhookAuth(webhookKey, mallId)) {
    // 인증 실패 진단(값 노출 없이 존재 여부만): 매칭완료인데 입금확인이 안 될 때
    //   PAYACTION_WEBHOOK_KEY 환경값 불일치를 즉시 가려내기 위함.
    console.warn(
      "[payaction/webhook] 인증 실패 — x-webhook-key 존재:",
      Boolean(webhookKey),
      "x-mall-id 존재:",
      Boolean(mallId)
    );
    return NextResponse.json({ status: "error", reason: "unauthorized" }, { status: 401 });
  }

  // 2) 본문 파싱. 형식이 깨졌으면 재전송해도 동일하므로 200 으로 종료.
  //    응답 본문은 PayAction 규약상 정확히 {status:"success"} 여야 한다(여분 필드 금지 — 실패 간주 방지).
  let payload: { order_number?: string; order_status?: string; processing_date?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ status: "success" });
  }

  const orderNo = (payload.order_number ?? "").trim();
  const orderStatus = payload.order_status ?? "매칭완료";
  const processingDate = payload.processing_date ?? null;
  if (!orderNo) {
    return NextResponse.json({ status: "success" });
  }

  // 멱등 키: x-trace-id(문서상 항상 전송). 누락 시 주문번호+처리시각으로 대체해 멱등성 유지.
  const traceId =
    req.headers.get("x-trace-id") || `${orderNo}:${processingDate ?? ""}`;

  // 3) 입금확인 RPC. anon 클라이언트로 SECURITY DEFINER RPC 만 호출(service_role 미사용).
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("payaction_confirm", {
    p_order_no: orderNo,
    p_secret: confirmSecret,
    p_trace_id: traceId,
    p_order_status: orderStatus,
    p_processing_date: processingDate,
  });

  if (error) {
    // 일시 DB 오류 가능 → 5xx 로 응답해 재전송(최대 3회)을 받는다.
    console.error("[payaction/webhook] payaction_confirm 실패:", error.message);
    return NextResponse.json({ status: "error", reason: "confirm_failed" }, { status: 502 });
  }

  const r = (data ?? {}) as {
    changed?: boolean;
    status?: string;
    error?: string;
    ignored?: string;
    idempotent?: boolean;
    orphan?: boolean;
    orphan_inserted?: boolean;
    ship_name?: string | null;
    ship_phone?: string | null;
  };
  // 고아입금: 이미 취소된 주문에 입금이 매칭됨 → 관리자에게 즉시 SMS 알림(발송/환불 누락 방지).
  //   원장에 '이번에 처음 적재됐을 때만' 알린다(웹훅 재전송 시 중복 SMS 방지).
  if (r.orphan) {
    console.warn(
      "[payaction/webhook] 고아입금 감지 order_no:", orderNo,
      "inserted:", r.orphan_inserted ?? false
    );
    if (r.orphan_inserted) {
      await sendOrphanDepositAlert({
        orderNo,
        shipName: r.ship_name ?? null,
        shipPhone: r.ship_phone ?? null,
        paidAmount: null, // PayAction 경로는 권위 금액을 DB에서만 알 수 있어 원장에 적재됨(SMS엔 금액미상)
        payMethod: "무통장입금",
      });
    }
  }
  if (r.error) {
    // 주문없음 등 재시도해도 동일한 사유 → 로깅 후 200 으로 종료(발송중단 방지).
    console.warn("[payaction/webhook] 처리 불가:", r.error, "order_no:", orderNo);
  } else {
    // 정상 처리 로그(Netlify) — 첫 실제 웹훅이 입금확인까지 갔는지 추적.
    console.log(
      "[payaction/webhook] 처리 완료 order_no:", orderNo,
      "changed:", r.changed ?? false,
      "note:", r.status ?? r.ignored ?? (r.idempotent ? "idempotent" : "ok")
    );
  }

  // PayAction 규약: 정상 수신 응답은 정확히 {status:"success"} (여분 필드 시 실패 간주 위험).
  return NextResponse.json({ status: "success" });
}
