// 나이스페이먼츠(Server 승인 · Basic 인증) — 순수 로직. 네트워크·환경변수 없이 테스트한다.
//
//   공식 매뉴얼(github.com/nicepayments/nicepay-manual) 기준. 공식은 기억이 아니라 아래 문서에서 옮겼다.
//     · returnUrl 서명    api/payment-window-server.md  hex(sha256(authToken + clientId + amount + SecretKey))
//     · 승인/웹훅 서명    api/payment.md · api/hook.md   hex(sha256(tid + amount + ediDate + SecretKey))
//     · Basic 인증        common/api.md                  Base64(clientKey:secretKey)
//     · 취소 taxFreeAmt   api/cancel.md                  '취소금액 중 면세에 해당하는 금액'
//
//   이 파일은 서버 전용이다(시크릿을 인자로 받는다). 브라우저 코드에서 import 하지 않는다.
import { createHash, timingSafeEqual } from "node:crypto";
import { computeCashReceiptAmounts, isTaxFreeProduct } from "../cash-receipt-tax";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// 길이가 달라도 예외 없이 false. 비교 시간은 내용과 무관하다.
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? "").toLowerCase(), "utf8");
  const y = Buffer.from(String(b ?? "").toLowerCase(), "utf8");
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

export function basicAuthHeader(clientId: string, secretKey: string): string {
  return "Basic " + Buffer.from(`${clientId}:${secretKey}`, "utf8").toString("base64");
}

// returnUrl 로 온 인증 결과의 서명.
export function returnSignature(authToken: string, clientId: string, amount: number | string, secretKey: string): string {
  return sha256Hex(`${authToken}${clientId}${amount}${secretKey}`);
}

// 승인·취소·조회 응답과 웹훅의 서명.
export function responseSignature(tid: string, amount: number | string, ediDate: string, secretKey: string): string {
  return sha256Hex(`${tid}${amount}${ediDate}${secretKey}`);
}

// ── returnUrl 폼 ───────────────────────────────────────────────
export type AuthResult = {
  authResultCode: string;
  authResultMsg: string;
  tid: string;
  clientId: string;
  orderId: string;
  amount: number;
  authToken: string;
  signature: string;
  mallReserved: string;
};

export function parseAuthResult(form: { get(name: string): unknown }): AuthResult {
  const s = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  const amt = Number(s("amount"));
  return {
    authResultCode: s("authResultCode"),
    authResultMsg: s("authResultMsg"),
    tid: s("tid"),
    clientId: s("clientId"),
    orderId: s("orderId"),
    amount: Number.isFinite(amt) ? amt : NaN,
    authToken: s("authToken"),
    signature: s("signature"),
    mallReserved: s("mallReserved"),
  };
}

export type AuthCheck =
  | { ok: true }
  | { ok: false; reason: "auth_failed" | "client_mismatch" | "bad_signature" | "amount_mismatch" | "bad_input" };

// returnUrl 검증 — 승인 API 를 부르기 전에 반드시 통과해야 한다.
//   expectedAmount 는 DB(orders.total_amount) 값이다. 브라우저·PG 가 보낸 금액은 믿지 않는다.
export function verifyAuthResult(r: AuthResult, clientId: string, secretKey: string, expectedAmount: number): AuthCheck {
  if (r.authResultCode !== "0000") return { ok: false, reason: "auth_failed" };
  if (!r.tid || !r.orderId || !r.authToken || !r.signature || !Number.isFinite(r.amount)) {
    return { ok: false, reason: "bad_input" };
  }
  if (r.clientId !== clientId) return { ok: false, reason: "client_mismatch" };
  // 서명은 PG 가 보낸 amount 문자열 그대로로 계산된다. 먼저 서명으로 위변조를 거르고, 그다음 DB 금액과 맞춘다.
  if (!safeEqualHex(r.signature, returnSignature(r.authToken, clientId, r.amount, secretKey))) {
    return { ok: false, reason: "bad_signature" };
  }
  if (r.amount !== expectedAmount) return { ok: false, reason: "amount_mismatch" };
  return { ok: true };
}

// ── PG 응답(승인·취소·조회·웹훅) ───────────────────────────────
export type NicepayPayment = {
  resultCode?: string;
  resultMsg?: string;
  tid?: string;
  cancelledTid?: string | null;
  orderId?: string;
  ediDate?: string;
  signature?: string;
  status?: string;
  paidAt?: string;
  cancelledAt?: string;
  payMethod?: string;
  amount?: number;
  balanceAmt?: number;
  goodsName?: string;
  approveNo?: string;
  card?: { cardName?: string; canPartCancel?: boolean | string } | null;
  cancels?: { tid?: string; amount?: number; cancelledAt?: string; reason?: string }[] | null;
  [k: string]: unknown;
};

export function verifyResponseSignature(p: NicepayPayment, secretKey: string): boolean {
  if (!p.tid || p.amount == null || !p.ediDate || !p.signature) return false;
  return safeEqualHex(p.signature, responseSignature(p.tid, p.amount, p.ediDate, secretKey));
}

// paidAt 등은 미해당이면 "0". 날짜로 읽히지 않으면 null.
export function pgTime(v: unknown): string | null {
  if (typeof v !== "string" || v === "" || v === "0") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// 손님 화면·주문 기록용 결제수단 라벨.
export function payMethodLabel(payMethod: string | undefined): string {
  switch (payMethod) {
    case "card":
      return "카드";
    case "kakaopay":
      return "카카오페이";
    case "naverpay":
      return "네이버페이";
    case "samsungpay":
      return "삼성페이";
    case "payco":
      return "페이코";
    case "ssgpay":
      return "SSG페이";
    default:
      return "카드·간편결제";
  }
}

// 웹훅 중복 판정 키 — 같은 거래의 같은 상태 통보는 하나로 본다(부분취소는 회차마다 다르다).
export function webhookDedupeKey(p: NicepayPayment): string {
  return [p.tid ?? "", p.status ?? "", p.cancelledTid ?? "", p.balanceAmt ?? "", p.ediDate ?? ""].join("|");
}

// ── 면세 계산 ────────────────────────────────────────────────
//   현금영수증과 같은 계산기(lib/cash-receipt-tax)를 쓴다 — 우유=면세, 요거트=과세,
//   배송비는 과세 품목이 하나라도 있으면 과세, 적립금 차감은 면세/과세 비례 배분.
export type OrderLine = { product_id: string; unit_price: number; qty: number };
export type OrderForTax = {
  items: OrderLine[];
  total_amount: number;
  block_weeks?: number | null;
  shipping_fee?: number | null;
};

export function paymentTaxFreeAmount(o: OrderForTax): number {
  return computeCashReceiptAmounts(
    o.items.map((it) => ({ productId: it.product_id, unitPrice: it.unit_price, qty: it.qty })),
    o.total_amount,
    { weeks: o.block_weeks ?? 1, shippingFee: o.shipping_fee ?? undefined }
  ).taxFreeAmount;
}

export type CancelPlanInput = {
  order: OrderForTax;
  paidAmount: number; // 승인 금액(= 주문 금액)
  paidTaxFree: number; // 승인 때 보낸 면세금액
  cancelledAmt: number; // 지금까지 취소된 금액
  cancelledTaxFree: number; // 지금까지 취소된 면세금액
} & (
  | { mode: "full" }
  | { mode: "amount"; amount: number }
  | { mode: "items"; items: { product_id: string; qty: number }[]; includeShipping: boolean }
);

export type CancelPlan =
  | { ok: true; full: boolean; cancelAmt: number; taxFreeAmt: number; items?: unknown }
  | { ok: false; reason: string };

// 취소 금액과 그중 면세금액을 서버가 정한다. 관리자 화면이 보낸 숫자는 '무엇을 취소할지'만 쓴다.
//   불변식: 누적 취소 ≤ 승인 금액, 누적 취소 면세 ≤ 승인 면세, 마지막 취소는 남은 면세를 정확히 털어낸다.
export function planCancel(input: CancelPlanInput): CancelPlan {
  const remain = input.paidAmount - input.cancelledAmt;
  const remainFree = Math.max(0, input.paidTaxFree - input.cancelledTaxFree);
  if (remain <= 0) return { ok: false, reason: "이미 전액 취소된 결제입니다." };

  if (input.mode === "full") {
    return { ok: true, full: input.cancelledAmt === 0, cancelAmt: remain, taxFreeAmt: remainFree };
  }

  let cancelAmt: number;
  let taxFree: number;
  let items: unknown;

  if (input.mode === "amount") {
    cancelAmt = Math.round(input.amount);
    if (!Number.isFinite(cancelAmt) || cancelAmt <= 0) return { ok: false, reason: "취소 금액을 확인해 주세요." };
    if (cancelAmt > remain) return { ok: false, reason: `취소 가능 금액(${remain.toLocaleString("ko-KR")}원)을 넘습니다.` };
    // 금액만 정하는 취소(구독 중도해지 환불 등): 원 결제의 면세 비율대로 나눈다.
    taxFree = input.paidAmount > 0 ? Math.round((cancelAmt * input.paidTaxFree) / input.paidAmount) : 0;
  } else {
    // 품목 선택 취소: 고른 품목·배송비의 '정가'를 면세/과세로 나누고, 적립금 등으로 실결제가 정가보다
    //   작았으면 같은 비율로 줄인다(결제 때와 같은 배분).
    const weeks = Math.max(1, Math.round(input.order.block_weeks ?? 1));
    const byId = new Map(input.order.items.map((it) => [it.product_id, it]));
    let free = 0;
    let taxable = 0;
    const picked: { product_id: string; qty: number; unit_price: number }[] = [];
    for (const sel of input.items) {
      const line = byId.get(sel.product_id);
      const qty = Math.round(sel.qty);
      if (!line || qty <= 0) continue;
      if (qty > line.qty) return { ok: false, reason: `${sel.product_id} 수량이 주문 수량보다 많습니다.` };
      const v = line.unit_price * qty * weeks;
      if (isTaxFreeProduct(sel.product_id)) free += v;
      else taxable += v;
      picked.push({ product_id: sel.product_id, qty, unit_price: line.unit_price });
    }
    const goodsTaxable = input.order.items.some((it) => !isTaxFreeProduct(it.product_id));
    const ship = input.includeShipping ? Math.max(0, input.order.shipping_fee ?? 0) : 0;
    if (goodsTaxable) taxable += ship;
    else free += ship;
    const gross = free + taxable;
    if (gross <= 0) return { ok: false, reason: "취소할 품목을 골라 주세요." };

    const orderGross =
      input.order.items.reduce((s, it) => s + it.unit_price * it.qty * weeks, 0) + Math.max(0, input.order.shipping_fee ?? 0);
    const ratio = orderGross > 0 && input.order.total_amount < orderGross ? input.order.total_amount / orderGross : 1;
    cancelAmt = Math.round(gross * ratio);
    taxFree = Math.round(free * ratio);
    if (cancelAmt > remain) return { ok: false, reason: `취소 가능 금액(${remain.toLocaleString("ko-KR")}원)을 넘습니다.` };
    items = { lines: picked, shipping: input.includeShipping };
  }

  // 마지막 취소면 남은 면세를 정확히, 아니면 남은 면세·취소액 범위 안으로.
  if (cancelAmt === remain) taxFree = remainFree;
  taxFree = Math.max(0, Math.min(taxFree, remainFree, cancelAmt));
  // 과세분이 남은 과세분보다 크면 면세로 넘긴다(반올림 누적 보정).
  const remainTaxable = remain - remainFree;
  if (cancelAmt - taxFree > remainTaxable) taxFree = Math.min(cancelAmt, remainFree, cancelAmt - remainTaxable);

  return { ok: true, full: cancelAmt === remain && input.cancelledAmt === 0, cancelAmt, taxFreeAmt: taxFree, items };
}

// 상품명 — 40자, " 와 | 는 매뉴얼대로 '-' 로 바꾼다.
export function goodsNameFor(names: string[]): string {
  const first = names[0] ?? "송영신목장 상품";
  const s = names.length > 1 ? `${first} 외 ${names.length - 1}건` : first;
  return s.replace(/["|]/g, "-").slice(0, 40);
}

// 부분취소 요청 orderId — 원 주문번호 + 회차. 매뉴얼: 부분취소는 중복된 orderId 로 재호출 불가(64자).
export function cancelOrderIdFor(orderNo: string, seq: number): string {
  return `${orderNo}-C${seq}`.slice(0, 64);
}
