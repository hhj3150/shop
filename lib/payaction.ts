// PayAction(페이액션) 무통장입금 자동확인 — 주문등록 클라이언트.
//
// 이 모듈은 서버에서만 호출한다(PAYACTION_API_KEY 필요). 브라우저 노출 금지.
// 환경변수(서버 전용, 커밋 금지): PAYACTION_API_BASE, PAYACTION_API_KEY, PAYACTION_MALL_ID.

import { normalizePhone } from "./phone";

const DEFAULT_BASE = "https://api.payaction.app";

// 주문번호 길이 상한. 초과 시 PayAction 알림톡 발송이 불가하다(문서 권장: 22자 이하).
const MAX_ORDER_NUMBER_LEN = 22;

// 전화번호 정규화: 클라/서버 공용 lib/phone.ts 로 추출됨(단일 출처). 재노출.
export { normalizePhone };

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

// 주문취소 통지. PayAction 이 그 주문번호로 더는 입금을 매칭하지 않게 한다.
//   (2026-08 개발자문서 개정으로 정식 API 가 생겼다: POST /orders/{order_number}/cancel.
//    구 /order-exclude 는 DEPRECATED — 종료 예정이라 쓰지 않는다.)
//   이걸 안 부르면 취소한 주문에 뒤늦게 입금이 들어와 '고아입금'으로 남는다.
//   응답에는 연결된 현금영수증의 취소 결과(cashbill)가 함께 온다 — 현금영수증이 없으면 생략된다.
//   그 값을 호출측이 우리 DB 에 남겨, 취소된 주문이 '발행완료'로 계속 보이지 않게 한다.
export type CancelOrderResult =
  | {
      ok: true;
      // cashbill 은 연결된 현금영수증이 있을 때만 온다.
      //   status: 'cancelled' | 'partially_cancelled' | 'cancel_failed'
      //   cancel_failed 면 주문만 취소되고 영수증은 살아 있다 — 사람이 처리해야 한다.
      cashbill?: { id?: number; status?: string };
      cashbillError?: { code?: string; message?: string };
    }
  | { ok: false; reason: string };

export async function cancelOrder(orderNumber: string): Promise<CancelOrderResult> {
  if (!isPayActionConfigured()) return { ok: false, reason: "not_configured" };
  const orderNo = orderNumber.trim();
  if (!validateOrderNumber(orderNo)) return { ok: false, reason: "invalid_order_number" };

  const base = process.env.PAYACTION_API_BASE || DEFAULT_BASE;
  try {
    // 금액을 넘기지 않으면 남은 금액 전체취소다(부분취소는 쓰지 않는다).
    const res = await fetch(`${base}/orders/${encodeURIComponent(orderNo)}/cancel`, {
      method: "POST",
      headers: {
        "x-api-key": process.env.PAYACTION_API_KEY as string,
        "x-mall-id": process.env.PAYACTION_MALL_ID as string,
      },
    });
    const data = (await res.json().catch(() => null)) as
      | {
          status?: string;
          response?: { message?: string };
          error?: { code?: string; message?: string };
          cashbill?: { id?: number; status?: string };
        }
      | null;
    if (res.ok && data?.status === "success") {
      return { ok: true, cashbill: data.cashbill, cashbillError: data.error };
    }
    const reason = data?.error?.message || data?.response?.message || `http_${res.status}`;
    return { ok: false, reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request_failed";
    return { ok: false, reason };
  }
}

export type RegisterOrderInput = {
  orderNumber: string;
  orderAmount: number;
  orderDate: string; // ISO 8601 (+09:00). 호출측(RPC)에서 KST 로 포맷해 전달.
  billingName: string; // 입금자명 — 자동매칭 기준
  ordererName: string;
  // ★ 이 필드를 넣으면 PayAction 이 입금확인 알림톡을 손님에게 보낼 수 있다
  //   (문서: "주문자에게 결제완료 알림 메시지 발송을 원하는 경우 주문자 전화번호를 포함").
  //   실제 발송 여부는 PayAction 대시보드의 구매자 알림 설정에 달렸다.
  ordererPhone?: string;
  ordererEmail?: string;
  // ── 현금영수증 자동발행(2026-08 전환) ──
  //   셋을 함께 보내면 입금이 매칭될 때 PayAction 이 현금영수증을 자동 발행하고,
  //   결과를 매칭완료 웹훅의 cashbill 필드로 돌려준다. 관리자가 대시보드에서 손으로
  //   발행하던 단계를 없애 이중발행·누락을 구조로 막는다.
  //   ★ tax_free_amount 를 빼면 전액 과세로 발행된다 — 우유(면세)가 대부분이라 반드시 넣는다.
  taxFreeAmount?: number; // 면세금액(원). 0 이면 전액 과세, 주문금액과 같으면 전액 면세.
  tradeUsage?: "소득공제용" | "지출증빙용";
  identityNumber?: string; // 소득공제용=휴대폰번호, 지출증빙용=사업자번호 (숫자만)
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

  // 면세금액은 0 도 의미가 있다(전액 과세) → undefined 일 때만 생략한다.
  //   문서: 0=전액 과세, 주문금액과 같으면 전액 면세, 그 사이는 혼합. 범위를 벗어난 값은
  //   유효하지 않은 요청이 되므로(과다 제출 시 이용 제한) 주문금액 안으로 묶는다.
  if (typeof input.taxFreeAmount === "number" && Number.isFinite(input.taxFreeAmount)) {
    const clamped = Math.min(Math.max(0, Math.round(input.taxFreeAmount)), input.orderAmount);
    body.tax_free_amount = clamped;
  }
  // 거래구분·식별번호는 '둘 다' 있어야 자동발행된다. 하나만 보내면 자동발행도 자진발급도
  //   되지 않는다(문서: 둘 중 하나라도 전달되면 자진발급 안 됨) → 쌍으로만 싣는다.
  const identity = (input.identityNumber ?? "").replace(/[^0-9]/g, "");
  if (input.tradeUsage && identity) {
    body.trade_usage = input.tradeUsage;
    body.identity_number = identity;
  } else if (input.tradeUsage && !identity) {
    // 손님은 본인 명의 현금영수증을 원했는데 식별번호가 비어 있는 경우.
    //   이대로 두면 자진발급(국세청 지정번호 010-000-1234)으로 넘어가 손님이 공제를 못 받는다.
    //   주문 폼이 막고 있지만(validateCashReceipt), 레거시·외부 경로 대비 흔적을 남긴다.
    console.warn(
      "[payaction] 현금영수증 식별번호 없음 → 자동발행 불가, 자진발급될 수 있음:",
      input.orderNumber
    );
  }

  // 새로 추가한 선택 필드(현금영수증 자동발행용). 서버가 아직 이 필드를 모르면
  //   등록 자체가 실패할 수 있는데, 등록 실패는 곧 '자동 입금확인 불가'라 치명적이다.
  //   → 1차 시도가 실패하면 이 필드들을 빼고 한 번 더 시도한다(자동 입금확인이 우선).
  const OPTIONAL_KEYS = ["tax_free_amount", "trade_usage", "identity_number"] as const;
  const hasOptional = OPTIONAL_KEYS.some((k) => k in body);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${base}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PAYACTION_API_KEY as string,
        "x-mall-id": process.env.PAYACTION_MALL_ID as string,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => null)) as
      | { status?: string; response?: { message?: string } }
      | null;
    const ok = res.ok && data?.status === "success";
    return { ok, reason: data?.response?.message || `http_${res.status}` };
  };

  try {
    const first = await post(body);
    if (first.ok) return { ok: true };

    if (hasOptional) {
      const fallback: Record<string, unknown> = { ...body };
      for (const k of OPTIONAL_KEYS) delete fallback[k];
      const second = await post(fallback);
      if (second.ok) {
        // 등록은 살렸지만 현금영수증 자동발행 정보는 못 실었다 — 반드시 드러나게 남긴다.
        console.warn(
          "[payaction] 현금영수증 필드 없이 재등록 성공 —",
          "자동발행이 안 될 수 있습니다. 1차 실패 사유:",
          first.reason,
          "주문:",
          input.orderNumber
        );
        return { ok: true };
      }
      return { ok: false, reason: second.reason };
    }
    return { ok: false, reason: first.reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request_failed";
    return { ok: false, reason };
  }
}

// 현금영수증 재발행(주문 기반) — POST /cashbills { order_number }
//   자동발행이 실패한 건을 관리자가 화면에서 다시 시도할 때 쓴다.
//   문서: 주문 기반 발행은 주문 제출 시 넘긴 금액·발행정보를 그대로 사용하며,
//        수동발행/자동발행 토글과 무관하게 호출할 수 있다(프리미어 이상 플랜 필요).
//   ★ 이미 발행된 건에 다시 부르면 이중발행이 된다 — 호출측이 '발행 안 된 건'만 부른다.
export type IssueCashbillResult =
  | { ok: true; cashbillId?: number; status?: string }
  | { ok: false; reason: string };

export async function issueCashbill(orderNumber: string): Promise<IssueCashbillResult> {
  if (!isPayActionConfigured()) return { ok: false, reason: "not_configured" };
  const orderNo = orderNumber.trim();
  if (!validateOrderNumber(orderNo)) return { ok: false, reason: "invalid_order_number" };

  const base = process.env.PAYACTION_API_BASE || DEFAULT_BASE;
  try {
    const res = await fetch(`${base}/cashbills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.PAYACTION_API_KEY as string,
        "x-mall-id": process.env.PAYACTION_MALL_ID as string,
      },
      body: JSON.stringify({ order_number: orderNo }),
    });
    const data = (await res.json().catch(() => null)) as
      | {
          status?: string;
          cashbill?: { id?: number; status?: string };
          error?: { code?: string; message?: string };
          response?: { message?: string };
        }
      | null;
    if (res.ok && data?.status === "success") {
      return { ok: true, cashbillId: data.cashbill?.id, status: data.cashbill?.status };
    }
    const reason =
      data?.error?.message || data?.response?.message || `http_${res.status}`;
    return { ok: false, reason };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "request_failed" };
  }
}
