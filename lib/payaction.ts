// PayAction(페이액션) 무통장입금 자동확인 — 주문등록 클라이언트.
//
// 이 모듈은 서버에서만 호출한다(PAYACTION_API_KEY 필요). 브라우저 노출 금지.
// 환경변수(서버 전용, 커밋 금지): PAYACTION_API_BASE, PAYACTION_API_KEY, PAYACTION_MALL_ID.

const DEFAULT_BASE = "https://api.payaction.app";

// 주문번호 길이 상한. 초과 시 PayAction 알림톡 발송이 불가하다(문서 권장: 22자 이하).
const MAX_ORDER_NUMBER_LEN = 22;

// 전화번호 정규화: 숫자만 남기고 국가코드(+82)를 0 으로 치환한다.
//   "010-1234-5678" → "01012345678", "+82 10-1234-5678" → "01012345678".
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("82") ? "0" + digits.slice(2) : digits;
}

// 주문번호 유효성: 공백 아님 + 22자 이하.
export function validateOrderNumber(orderNumber: string): boolean {
  const trimmed = orderNumber.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_ORDER_NUMBER_LEN;
}

// 서버 환경에 PayAction 키가 모두 설정되어 있는지.
export function isPayActionConfigured(): boolean {
  return Boolean(process.env.PAYACTION_API_KEY && process.env.PAYACTION_MALL_ID);
}

// 매칭완료 웹훅 인증: x-webhook-key 와 x-mall-id 가 환경값과 정확히 일치해야 통과.
//   환경값이 비어 있으면(미설정) 항상 거절한다.
export function verifyWebhookAuth(
  webhookKey: string | null | undefined,
  mallId: string | null | undefined,
): boolean {
  const expectedKey = process.env.PAYACTION_WEBHOOK_KEY;
  const expectedMall = process.env.PAYACTION_MALL_ID;
  if (!expectedKey || !expectedMall) return false;
  return webhookKey === expectedKey && mallId === expectedMall;
}

export type RegisterOrderInput = {
  orderNumber: string;
  orderAmount: number;
  orderDate: string; // ISO 8601 (+09:00). 호출측(RPC)에서 KST 로 포맷해 전달.
  billingName: string; // 입금자명 — 자동매칭 기준
  ordererName: string;
  ordererPhone?: string; // 입금확인 문자 발송용(PayAction 직접 발송)
  ordererEmail?: string;
};

export type RegisterOrderResult = { ok: true } | { ok: false; reason: string };

// PayAction 에 입금 예정 주문을 등록한다. 실패는 throw 하지 않고 reason 으로 흡수한다
//   (등록 실패가 주문 자체를 막지 않도록 — 호출측에서 non-fatal 처리).
export async function registerOrder(
  input: RegisterOrderInput,
): Promise<RegisterOrderResult> {
  if (!isPayActionConfigured()) return { ok: false, reason: "not_configured" };

  if (!validateOrderNumber(input.orderNumber)) {
    return { ok: false, reason: "invalid_order_number" };
  }
  if (!input.billingName.trim()) {
    return { ok: false, reason: "missing_billing_name" };
  }
  if (!Number.isInteger(input.orderAmount) || input.orderAmount <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const base = process.env.PAYACTION_API_BASE || DEFAULT_BASE;
  const body: Record<string, unknown> = {
    order_number: input.orderNumber.trim(),
    order_amount: input.orderAmount,
    order_date: input.orderDate,
    billing_name: input.billingName.trim(),
    orderer_name: input.ordererName.trim() || input.billingName.trim(),
  };
  if (input.ordererPhone) {
    const phone = normalizePhone(input.ordererPhone);
    if (phone) body.orderer_phone_number = phone;
  }
  if (input.ordererEmail) body.orderer_email = input.ordererEmail.trim();

  try {
    const res = await fetch(`${base}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PAYACTION_API_KEY as string,
        "x-mall-id": process.env.PAYACTION_MALL_ID as string,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as
      | { status?: string; response?: { message?: string } }
      | null;

    if (res.ok && data?.status === "success") return { ok: true };
    const reason = data?.response?.message || `http_${res.status}`;
    return { ok: false, reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request_failed";
    return { ok: false, reason };
  }
}
