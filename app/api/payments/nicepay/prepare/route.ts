import { NextResponse } from "next/server";
import { nicepayCheckoutConfig, nicepayEasyPayOn, nicepayWindowMethod } from "@/lib/nicepay/server";
import { goodsNameFor, paymentTaxFreeAmount } from "@/lib/nicepay/core";
import { anonClient, loadOrder } from "@/lib/nicepay/settle";
import { getProduct } from "@/lib/products";

// 결제창 띄우기 전 준비 — 결제창에 넣을 금액·면세금액·상품명을 서버(DB)가 정해 준다.
//   브라우저가 계산한 금액은 쓰지 않는다. 주문번호만으로 남의 주문 정보를 못 보게 받는 분 연락처를 함께 대조한다.
//   클라이언트 키(clientId)는 결제창에 원래 노출되는 값이라 돌려줘도 된다. 시크릿 키는 절대 돌려주지 않는다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const digits = (s: unknown) => (typeof s === "string" ? s.replace(/\D/g, "") : "");

// 결제수단 화면용: 카드결제를 보여도 되는지(스위치 + 키)만 알려 준다. 꺼져 있으면 {enabled:false} — 오류가 아니다.
export async function GET() {
  const enabled = Boolean(nicepayCheckoutConfig() && process.env.CONFIRM_PAYMENT_SECRET);
  return NextResponse.json({ enabled, easyPay: enabled && nicepayEasyPayOn() });
}

export async function POST(req: Request) {
  const cfg = nicepayCheckoutConfig();
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const sb = anonClient();
  if (!cfg || !secret || !sb) {
    // 스위치 꺼짐/키 없음: 카드결제 비활성. 화면은 이미 카드를 숨기므로 정상 흐름에선 오지 않는다.
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as { orderNo?: unknown; phone?: unknown } | null;
  const orderNo = typeof body?.orderNo === "string" ? body.orderNo.trim() : "";
  if (!orderNo) return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });

  const order = await loadOrder(sb, secret, orderNo);
  if (!order) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  if (!digits(order.ship_phone) || digits(order.ship_phone) !== digits(body?.phone)) {
    return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  }
  if (order.status !== "입금대기") {
    return NextResponse.json({ ok: false, reason: "not_payable", status: order.status }, { status: 409 });
  }
  // 선물 주문은 이번 범위에서 무통장만(권장안). 품목을 못 읽으면 면세를 정할 수 없어 카드결제를 막는다.
  if (order.is_gift) return NextResponse.json({ ok: false, reason: "gift_bank_only" }, { status: 409 });
  if (!order.items?.length || !(order.total_amount > 0)) {
    return NextResponse.json({ ok: false, reason: "order_items_missing" }, { status: 409 });
  }

  // 이미 승인된 카드결제가 있으면(주문 확인만 늦는 중) 다시 결제하지 못하게 막는다 — 이중 청구 방지.
  const { data: prior } = await sb.rpc("nicepay_payment_for_order", { p_secret: secret, p_order_no: orderNo });
  const pr = prior as { tid?: string; status?: string } | null;
  if (pr?.tid && pr.status !== "cancelled") {
    return NextResponse.json({ ok: false, reason: "not_payable", status: "paid" }, { status: 409 });
  }

  const names = order.items.map((it) => {
    const p = getProduct(it.product_id);
    return p ? `${p.name} ${p.volume}` : it.product_id;
  });
  const goodsName =
    order.order_type === "구독" ? goodsNameFor([`${names[0]} 정기구독`, ...names.slice(1)]) : goodsNameFor(names);

  return NextResponse.json({
    ok: true,
    clientId: cfg.clientId,
    method: nicepayWindowMethod(),
    orderId: order.order_no,
    amount: order.total_amount,
    taxFreeAmt: paymentTaxFreeAmount(order),
    goodsName,
    buyerName: (order.ship_name ?? "").slice(0, 30),
    buyerTel: digits(order.ship_phone).slice(0, 40),
  });
}
