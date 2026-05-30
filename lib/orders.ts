import { getSupabase } from "./supabase";
import type { CartItem } from "./cart";
import { getProduct, BLOCK_WEEKS } from "./products";

export type ShippingInfo = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  depositorName: string;
  memo: string;
};

function makeOrderNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SY${stamp}-${rand}`;
}

// 무통장입금 정기구독 주문 생성. 결제 단위 = 4주분(주 1회 × 4주 = 4회).
// 로그인된 회원만 호출 가능(RLS).
export async function createOrder(
  userId: string,
  items: CartItem[],
  ship: ShippingInfo
): Promise<{ orderNo: string }> {
  if (items.length === 0) throw new Error("장바구니가 비어 있습니다.");

  const supabase = getSupabase();
  const orderNo = makeOrderNo();
  // 입금 금액 = 회당 합계 × 4주.
  const total = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0) * BLOCK_WEEKS;

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      order_no: orderNo,
      total_amount: total,
      has_subscription: true,
      block_weeks: BLOCK_WEEKS,
      depositor_name: ship.depositorName.trim() || ship.name.trim(),
      ship_name: ship.name.trim(),
      ship_phone: ship.phone.replace(/[^0-9]/g, ""),
      ship_postcode: ship.postcode.trim() || null,
      ship_address: ship.address.trim(),
      ship_address_detail: ship.addressDetail.trim() || null,
      memo: ship.memo.trim() || null,
    })
    .select("id, order_no")
    .single();

  if (orderErr || !order) {
    throw new Error(orderErr?.message ?? "주문 생성에 실패했습니다.");
  }

  const rows = items.map((i) => {
    const p = getProduct(i.productId);
    return {
      order_id: order.id,
      product_id: i.productId,
      product_name: p?.name ?? i.productId,
      volume: p?.volume ?? "",
      delivery_day: i.deliveryDay,
      qty: i.qty,
      unit_price: i.unitPrice,
    };
  });

  const { error: itemsErr } = await supabase.from("order_items").insert(rows);
  if (itemsErr) throw new Error(itemsErr.message);

  return { orderNo: order.order_no };
}
