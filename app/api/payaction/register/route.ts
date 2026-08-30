import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { registerOrder, isPayActionConfigured } from "@/lib/payaction";
import { normalizeBillingName } from "@/lib/depositor-name";
import { computeCashReceiptAmounts } from "@/lib/cash-receipt-tax";

// PayAction 주문등록 라우트. 주문 생성 직후 브라우저가 호출한다(orderNo + 주문자 연락처).
//
// 보안 설계:
//   - PAYACTION_API_KEY 가 필요한 등록은 서버에서만 수행한다(브라우저 노출 금지).
//   - 금액·입금자명은 클라이언트 값이 아니라 payaction_order_payload RPC 로 DB 권위값을 재조회한다(C1).
//   - 등록 실패는 주문을 막지 않는다(non-fatal): ok:false 를 200 으로 반환하고 호출측은 무시한다.
//
// 환경변수: PAYACTION_*(클라이언트), CONFIRM_PAYMENT_SECRET(RPC), NEXT_PUBLIC_SUPABASE_*.

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isPayActionConfigured()) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  const confirmSecret = process.env.CONFIRM_PAYMENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!confirmSecret || !supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  let body: {
    orderNo?: string;
    ordererPhone?: string;
    ordererName?: string;
    ordererEmail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const orderNo = (body.orderNo ?? "").trim();
  if (!orderNo) {
    return NextResponse.json({ ok: false, reason: "missing_order_no" }, { status: 400 });
  }
  // 진입 로그 — 호출이 서버 라우트에 도달했는지 확인(도달 안 함 vs 도달 후 성공/실패 구분).
  console.log("[payaction/register] hit order_no:", orderNo);

  // DB 권위 필드 조회(금액·입금자명·주문일).
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("payaction_order_payload", {
    p_order_no: orderNo,
    p_secret: confirmSecret,
  });
  if (error) {
    console.error("[payaction/register] payload 조회 실패:", error.message);
    return NextResponse.json({ ok: false, reason: "lookup_failed" });
  }

  const o = (data ?? {}) as {
    found?: boolean;
    total_amount?: number;
    depositor_name?: string | null;
    ship_name?: string | null;
    ship_phone?: string | null;
    is_gift?: boolean;
    gifter_name?: string | null;
    status?: string;
    order_date?: string;
    // 현금영수증 자동발행용
    block_weeks?: number | null;
    shipping_fee?: number | null;
    cash_receipt_type?: string | null;
    cash_receipt_id?: string | null;
    items?: { product_id: string; unit_price: number; qty: number }[];
  };
  if (!o.found) {
    return NextResponse.json({ ok: false, reason: "order_not_found" });
  }
  if (o.status !== "입금대기") {
    // 이미 확인/취소된 주문은 등록하지 않는다.
    return NextResponse.json({ ok: false, reason: "not_pending" });
  }

  // 입금자명 정규화(방어): 신규 주문은 저장 시 이미 정규화되지만, 레거시·외부 경로 대비
  //   등록 직전 한 번 더 괄호 메모를 떼어 통장 보내는분 이름과 정합시킨다(자동매칭 실패 방지).
  const billingName = normalizeBillingName(o.depositor_name);
  if (!billingName) {
    // 입금자명이 비면 자동매칭이 불가하므로 등록을 건너뛴다(관리자 수동 처리).
    return NextResponse.json({ ok: false, reason: "missing_depositor_name" });
  }

  const ordererName = o.is_gift
    ? (o.gifter_name ?? billingName)
    : ((o.ship_name ?? "").trim() || billingName);
  // 입금확인 문자 수신처: 선물이면 보내는 분(클라이언트 제공) 번호, 일반은 배송 연락처.
  const ordererPhone = (body.ordererPhone ?? "").trim() || (o.ship_phone ?? "").trim();

  // ── 현금영수증 자동발행 정보 ──
  //   손님이 주문할 때 고른 발행 방식·식별번호를 그대로 싣는다. '발행안함'이면 싣지 않는다.
  //   면세금액은 우리 계산기가 단일 출처다(우유=면세, 요거트=과세, 배송비 귀속 규칙 포함).
  //   구독 주문의 품목 수량은 '회당'이므로 block_weeks 를 반드시 넘긴다 — 빠뜨리면
  //   면세/과세 분리가 크게 어긋나 잘못된 금액으로 영수증이 나간다.
  const receiptAmounts = computeCashReceiptAmounts(
    (o.items ?? []).map((it) => ({
      productId: it.product_id,
      unitPrice: it.unit_price,
      qty: it.qty,
    })),
    o.total_amount as number,
    { weeks: o.block_weeks ?? 1, shippingFee: o.shipping_fee ?? undefined }
  );
  const tradeUsage =
    o.cash_receipt_type === "소득공제"
      ? ("소득공제용" as const)
      : o.cash_receipt_type === "지출증빙"
        ? ("지출증빙용" as const)
        : undefined;

  const result = await registerOrder({
    orderNumber: orderNo,
    orderAmount: o.total_amount as number,
    orderDate: o.order_date as string,
    billingName,
    ordererName,
    ordererPhone: ordererPhone || undefined,
    ordererEmail: body.ordererEmail?.trim() || undefined,
    // 품목을 못 읽었으면(레거시·이상 데이터) 면세금액을 보내지 않는다 —
    //   0 을 보내면 '전액 과세'로 잘못 발행되므로, 차라리 생략해 기존 동작을 따른다.
    taxFreeAmount: (o.items ?? []).length > 0 ? receiptAmounts.taxFreeAmount : undefined,
    tradeUsage,
    identityNumber: tradeUsage ? (o.cash_receipt_id ?? undefined) : undefined,
  });

  if (!result.ok) {
    console.warn("[payaction/register] 등록 실패:", result.reason, "order_no:", orderNo);
  } else {
    console.log("[payaction/register] 등록 성공 order_no:", orderNo);
  }
  return NextResponse.json(result);
}
