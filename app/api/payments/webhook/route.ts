import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PortOneClient, Webhook } from "@portone/server-sdk";
import { sendInfo, isSolapiConfigured, type AlimtalkSpec } from "@/lib/solapi";
import { sendOrphanDepositAlert } from "@/lib/orphan-alert";

// PortOne(포트원) v2 결제 웹훅 수신.
//
// 보안 설계:
//   1) 웹훅 서명 검증(Webhook.verify) → 포트원이 보낸 요청만 통과.
//   2) PG 단건 조회(getPayment)로 결제 상태/금액을 PG 권위값으로 재확인 → 위조 차단.
//   3) DB 입금확인은 SECURITY DEFINER RPC(confirm_payment)가 수행하며,
//      Vault 공유 시크릿(CONFIRM_PAYMENT_SECRET)으로 호출자를 한 번 더 검증한다(service_role 미사용).
//   4) RPC가 금액을 orders.total_amount 와 다시 대조하고, 멱등 처리한다.
//
// 환경변수(서버 전용, 절대 커밋 금지): PORTONE_API_SECRET, PORTONE_WEBHOOK_SECRET, CONFIRM_PAYMENT_SECRET.
// 미설정 시 503 으로 거절(라이브에서는 무통장 폴백 흐름이 동작하므로 웹훅이 오지 않음).

export const runtime = "nodejs";

const SHOP = "송영신목장";

// PG 결제수단 타입 → 정보성 한글 라벨(orders.pay_method 기록용).
function payMethodLabel(type?: string): string | null {
  switch (type) {
    case "PaymentMethodCard":
      return "카드";
    case "PaymentMethodVirtualAccount":
      return "가상계좌";
    case "PaymentMethodEasyPay":
      return "간편결제";
    case "PaymentMethodTransfer":
      return "계좌이체";
    case "PaymentMethodMobile":
      return "휴대폰";
    default:
      return type ?? null;
  }
}

export async function POST(req: Request) {
  const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET;
  const apiSecret = process.env.PORTONE_API_SECRET;
  const confirmSecret = process.env.CONFIRM_PAYMENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!webhookSecret || !apiSecret || !confirmSecret || !supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  // 1) 원문 본문 + 서명 헤더로 웹훅 검증. 위변조/재전송은 여기서 막힌다.
  const body = await req.text();
  let webhook: Awaited<ReturnType<typeof Webhook.verify>>;
  try {
    webhook = await Webhook.verify(webhookSecret, body, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 400 });
  }

  // 결제 승인 이벤트만 처리한다. 그 외(가상계좌 발급 등)는 정상 수신(200)으로 무시한다.
  if (!("type" in webhook) || webhook.type !== "Transaction.Paid") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const paymentId = webhook.data.paymentId;

  // 2) PG 권위 조회: 실제 결제 상태/금액을 포트원에서 다시 확인한다.
  let payment;
  try {
    const portone = PortOneClient({ secret: apiSecret });
    payment = await portone.payment.getPayment({ paymentId });
  } catch (error) {
    console.error("[payments/webhook] getPayment 실패:", error);
    // 포트원 일시 오류일 수 있으므로 재시도를 받도록 5xx 로 응답.
    return NextResponse.json({ ok: false, reason: "lookup_failed" }, { status: 502 });
  }

  if (payment.status !== "PAID") {
    // 아직 승인 전(가상계좌 발급/대기 등)이면 변경 없이 정상 수신 처리.
    return NextResponse.json({ ok: true, status: payment.status });
  }

  const paidAmount = payment.amount.total;
  // method.type 은 인식 불가 시 symbol 일 수 있어 문자열일 때만 라벨링한다.
  const methodType =
    typeof payment.method?.type === "string" ? payment.method.type : undefined;
  const payMethod = payMethodLabel(methodType);
  const pgTxId = payment.pgTxId ?? payment.transactionId;

  // 3) DB 입금확인. anon 클라이언트로 SECURITY DEFINER RPC 만 호출(service_role 미사용).
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: result, error } = await supabase.rpc("confirm_payment", {
    p_order_no: paymentId,
    p_secret: confirmSecret,
    p_paid_amount: paidAmount,
    p_pay_method: payMethod,
    p_pg_tx_id: pgTxId,
  });

  if (error || !result) {
    console.error("[payments/webhook] confirm_payment 실패:", error?.message);
    // 금액 불일치/주문없음 등은 재시도해도 동일 → 200 으로 종료(무한 재시도 방지).
    return NextResponse.json({ ok: false, reason: error?.message ?? "confirm_failed" });
  }

  const r = result as {
    order_no: string;
    status: string;
    changed: boolean;
    orphan?: boolean;
    ship_name: string | null;
    ship_phone: string | null;
  };

  // 고아입금: 이미 취소된 주문에 결제가 들어옴 → 관리자에게 즉시 SMS 알림(발송/환불 누락 방지).
  if (r.orphan) {
    console.warn("[payments/webhook] 고아입금 감지 order_no:", r.order_no);
    await sendOrphanDepositAlert({
      orderNo: r.order_no,
      shipName: r.ship_name,
      shipPhone: r.ship_phone,
      paidAmount: paidAmount,
      payMethod: payMethod,
    });
  }

  // 4) 이번 호출로 처음 '입금확인'된 경우에만 입금확인 문자를 보낸다(멱등: 재전송 시 중복발송 없음).
  if (r.changed && r.status === "입금확인" && r.ship_phone && isSolapiConfigured()) {
    const name = r.ship_name || "고객";
    const text =
      `[${SHOP}] ${name}님, 입금이 확인되었습니다.\n` +
      `주문번호 ${r.order_no}\n` +
      `신선하게 준비하여 순차 발송해 드리겠습니다.`;
    const alimtalk: AlimtalkSpec = {
      templateKey: "PAYMENT_CONFIRMED",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": r.order_no,
      },
    };
    // 문자 실패가 입금확인(200)을 막지 않도록 결과만 로깅한다.
    const sent = await sendInfo(r.ship_phone, {
      text,
      subject: `[${SHOP}] 입금 확인`,
      alimtalk,
    });
    if (!sent.ok) console.warn("[payments/webhook] 입금확인 문자 실패:", sent.reason);
  }

  return NextResponse.json({ ok: true, changed: r.changed, status: r.status });
}
