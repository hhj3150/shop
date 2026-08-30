import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyWebhookAuth } from "@/lib/payaction";
import { sendOrphanDepositAlert } from "@/lib/orphan-alert";
import { sendInfo, isSolapiConfigured } from "@/lib/solapi";
import { logSms } from "@/lib/sms-log";
import { buildPaymentConfirmedMessage } from "@/lib/payment-confirmed-message";

// PayAction(페이액션) 매칭완료 웹훅 수신.
//
// 보안 설계:
//   1) x-webhook-key / x-mall-id 를 환경값과 대조해 PayAction 요청만 통과(verifyWebhookAuth).
//   2) DB 입금확인은 SECURITY DEFINER RPC(payaction_confirm)가 수행하며,
//      Vault 공유 시크릿(CONFIRM_PAYMENT_SECRET)으로 호출자를 한 번 더 검증한다(service_role 미사용).
//   3) x-trace-id 를 PK 로 저장해 동일 웹훅 재전송을 멱등 처리한다.
//   4) 입금확인 안내 문자는 기본적으로 보내지 않는다.
//      PayAction 대시보드의 '구매자 결제완료 알림(알림톡)'이 켜져 있고, 우리가 주문 등록 시
//      orderer_phone_number 를 실어 보내므로 손님은 페이액션 알림톡을 이미 받는다
//      (2026-08-30 설정 화면으로 확인). 우리가 또 보내면 두 통이 된다.
//      PAYACTION_CONFIRM_SMS=on 으로만 켠다 — 페이액션 구매자 알림을 끄는 날 이 값을 켜면 된다.
//      중복 방지는 sms_already_sent(주문당 1회) 로 서버가 한 번 더 강제한다.
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
  let payload: {
    order_number?: string;
    order_status?: string;
    processing_date?: string;
    // 현금영수증 자동발행 결과(2026-08 전환). 주문 등록 시 거래구분·식별번호를 실어
    //   보낸 주문에만 온다.
    cashbill?: {
      id?: number;
      status?: string; // 'issued' | 'issue_failed'
      error?: { code?: string; message?: string };
    };
  } & Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ status: "success" });
  }

  // PayAction 규격 변경 감지: 지금 아는 필드는 아래 넷이다(수신분 96건 전수 확인 기준
  //   셋 + 문서에 새로 생긴 cashbill). 모르는 필드가 붙으면 즉시 로그로 드러나 대응
  //   시점을 놓치지 않는다. 원문은 payaction_webhook_events.raw_body 에 그대로 적재된다.
  const KNOWN_KEYS = new Set([
    "order_number",
    "order_status",
    "processing_date",
    "cashbill",
  ]);
  const unknownKeys = Object.keys(payload as Record<string, unknown>).filter(
    (k) => !KNOWN_KEYS.has(k)
  );
  if (unknownKeys.length > 0) {
    console.warn("[payaction/webhook] 규격 변경 의심 — 새 필드:", unknownKeys.join(", "));
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
    // 관찰 안전장치: PayAction 원본 페이로드를 그대로 적재(입금확인 결정엔 미사용).
    //   며칠 관찰해 실제 '입금액' 필드 존재 여부를 증거로 확정 → 후속 금액검증 활성화.
    p_raw_body: payload,
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
  // 입금이 이번 웹훅으로 처음 확인된 건에만 입금확인 안내를 보낸다.
  //   changed=false(중복·이미 확인됨)면 보내지 않는다 — 재전송으로 같은 문자가 또 나가지 않게.
  //   ★ 기본값은 '보내지 않음'이다. 페이액션이 구매자 결제완료 알림톡을 이미 보내고 있어
  //   (대시보드 > 기능설정 > 구매자 결제완료 알림: 알림톡·이메일 사용), 우리까지 보내면
  //   손님이 같은 안내를 두 번 받는다. 페이액션 쪽을 끄는 날 PAYACTION_CONFIRM_SMS=on 으로 켠다.
  if (r.changed === true && process.env.PAYACTION_CONFIRM_SMS === "on") {
    await sendPaymentConfirmedSms(orderNo, supabaseUrl, supabaseAnon, confirmSecret);
  }

  // 현금영수증 자동발행 결과를 우리 DB 에 남긴다 — 관리자 화면이 '자동발행 완료'를 보고
  //   대시보드에서 또 발행하지 않게 하는 것이 목적이다(이중발행 방지).
  if (payload.cashbill) {
    await recordCashReceipt(orderNo, payload.cashbill, supabaseUrl, supabaseAnon, confirmSecret);
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

// 입금확인 안내 문자(자동 매칭 경로). 실패해도 웹훅 응답을 막지 않는다(best-effort).
//   수신번호·문구는 DB 권위값(payaction_order_payload RPC)으로만 구성한다.
async function sendPaymentConfirmedSms(
  orderNo: string,
  supabaseUrl: string,
  supabaseAnon: string,
  secret: string
): Promise<void> {
  if (!isSolapiConfigured()) return;
  try {
    const sb = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("payaction_order_payload", {
      p_order_no: orderNo,
      p_secret: secret,
    });
    if (error) {
      console.error("[payaction/webhook] 입금확인 문자 payload 조회 실패:", error.message);
      return;
    }
    const o = (data ?? {}) as {
      found?: boolean;
      order_id?: string | null;
      ship_name?: string | null;
      ship_phone?: string | null;
      ship_date?: string | null;
      delivery_method?: string | null;
    };
    if (!o.found || !o.ship_phone) return;

    // 주문당 1회 — 관리자가 이미 눌러 보냈거나 웹훅이 재전송돼도 두 번 나가지 않는다.
    if (o.order_id) {
      const { data: already } = await sb.rpc("sms_already_sent", {
        p_secret: secret,
        p_kind: "payment_confirmed",
        p_order_id: o.order_id,
        p_user_id: null,
      });
      if (already === true) return;
    }

    const m = buildPaymentConfirmedMessage({
      shipName: o.ship_name ?? null,
      orderNo,
      shipDate: o.ship_date ?? null,
      deliveryMethod: o.delivery_method ?? null,
    });
    const r = await sendInfo(o.ship_phone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: "PAYMENT_CONFIRMED", variables: m.variables },
    });
    await logSms({
      kind: "payment_confirmed",
      toPhone: o.ship_phone,
      body: m.text,
      templateKey: "PAYMENT_CONFIRMED",
      channel: "info",
      ok: r.ok,
      failReason: r.ok ? null : (r.reason ?? null),
      orderId: o.order_id ?? null,
      meta: { source: "payaction_webhook" },
    });
    if (!r.ok) console.warn("[payaction/webhook] 입금확인 문자 실패:", orderNo, r.reason);
  } catch (e) {
    console.error("[payaction/webhook] 입금확인 문자 예외:", e);
  }
}

// 현금영수증 자동발행 결과 기록. best-effort — 실패해도 웹훅 응답을 막지 않는다.
async function recordCashReceipt(
  orderNo: string,
  cashbill: { id?: number; status?: string; error?: { code?: string; message?: string } },
  supabaseUrl: string,
  supabaseAnon: string,
  secret: string
): Promise<void> {
  const status = cashbill.status === "issued" ? "issued" : "issue_failed";
  if (status === "issue_failed") {
    // 돈·세금 문제라 로그에 분명히 남긴다. 관리자 화면에도 실패 사유가 뜬다.
    console.error(
      "[payaction/webhook] 현금영수증 자동발행 실패 order_no:", orderNo,
      "code:", cashbill.error?.code,
      "message:", cashbill.error?.message
    );
  }
  try {
    const sb = createClient(supabaseUrl, supabaseAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("record_cash_receipt_auto", {
      p_secret: secret,
      p_order_no: orderNo,
      p_bill_id: cashbill.id ?? null,
      p_status: status,
      p_error: cashbill.error?.message ?? null,
    });
    if (error) {
      console.error("[payaction/webhook] 현금영수증 기록 실패:", orderNo, error.message);
      return;
    }
    const r = (data ?? {}) as { was_issued?: boolean };
    // 이미 '발행완료'로 표시돼 있던 주문이 자동발행까지 됐다면 이중발행 의심 — 즉시 드러나게 한다.
    if (r.was_issued === true) {
      console.error(
        "[payaction/webhook] ⚠ 이중발행 의심 — 수기 발행완료 표시가 있던 주문에 자동발행됨:",
        orderNo
      );
    }
  } catch (e) {
    console.error("[payaction/webhook] 현금영수증 기록 예외:", e);
  }
}
