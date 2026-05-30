import { getSupabase } from "./supabase";
import type { CartItem, DeliveryDay } from "./cart";
import { getProduct, BLOCK_WEEKS, SUB_DAY_CAP, onceShippingFee } from "./products";
import { nextDispatchDate, toISODate } from "./ship-date";

export type ShippingInfo = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  depositorName: string;
  memo: string;
};

// 신청 결과: 요일별로 몇 번째인지, 대기자인지.
export type SlotResult = {
  deliveryDay: DeliveryDay;
  position: number; // 해당 요일에서 몇 번째 (정원 내) 또는 대기자 순번
  waitlisted: boolean;
};

function makeOrderNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `SY${stamp}-${rand}`;
}

// 자동이체 정기구독 주문 생성. 결제 단위 = 4주분(주 1회 × 4주 = 4회).
// 로그인된 회원만 호출 가능(RLS). 요일별 선착순 슬롯도 함께 등록한다.
export async function createOrder(
  userId: string,
  items: CartItem[],
  ship: ShippingInfo
): Promise<{ orderNo: string; slots: SlotResult[] }> {
  if (items.length === 0) throw new Error("장바구니가 비어 있습니다.");

  const supabase = getSupabase();
  const orderNo = makeOrderNo();
  // 입금(자동이체) 금액 = 회당 합계 × 4주.
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

  // 요일별 선착순 슬롯 등록 — 장바구니에 담긴 요일(중복 제거)마다 1슬롯.
  const days = Array.from(new Set(items.map((i) => i.deliveryDay)));
  const slots = await registerSlots(userId, order.id, days);

  return { orderNo: order.order_no, slots };
}

// 단품(1회) 주문에 담는 항목.
export type OnceItem = {
  productId: string;
  qty: number;
  unitPrice: number; // 정가(할인 없음)
};

// 단품 1회 구매 주문 생성. 구독 슬롯은 등록하지 않으며, 발송일(ship_date)을 함께 저장한다.
// 입금 확인 후 ship_date에 맞춰 발송. 배송비 별도(ONCE_SHIPPING_KRW).
export async function createOnceOrder(
  userId: string,
  items: OnceItem[],
  ship: ShippingInfo
): Promise<{ orderNo: string; shipDate: string }> {
  const filtered = items.filter((i) => i.qty > 0);
  if (filtered.length === 0) throw new Error("담은 제품이 없습니다.");

  const supabase = getSupabase();
  const orderNo = makeOrderNo();
  const subtotal = filtered.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
  const shipping = onceShippingFee(subtotal);
  const total = subtotal + shipping;
  const shipDate = toISODate(nextDispatchDate());

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      order_no: orderNo,
      order_type: "단품",
      has_subscription: false,
      block_weeks: 1,
      ship_date: shipDate,
      shipping_fee: shipping,
      total_amount: total,
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

  const rows = filtered.map((i) => {
    const p = getProduct(i.productId);
    return {
      order_id: order.id,
      product_id: i.productId,
      product_name: p?.name ?? i.productId,
      volume: p?.volume ?? "",
      delivery_day: null,
      qty: i.qty,
      unit_price: i.unitPrice,
    };
  });

  const { error: itemsErr } = await supabase.from("order_items").insert(rows);
  if (itemsErr) throw new Error(itemsErr.message);

  return { orderNo: order.order_no, shipDate };
}

// 요일별 현재 점유 수를 보고 정원(100) 내면 '신청', 초과면 '대기'로 슬롯 등록.
async function registerSlots(
  userId: string,
  orderId: string,
  days: DeliveryDay[]
): Promise<SlotResult[]> {
  const supabase = getSupabase();
  const results: SlotResult[] = [];

  for (const day of days) {
    const { data: row } = await supabase
      .from("subscription_day_count")
      .select("taken, waitlist, capacity")
      .eq("delivery_day", day)
      .maybeSingle();

    const taken = (row?.taken as number) ?? 0;
    const waitlist = (row?.waitlist as number) ?? 0;
    const capacity = (row?.capacity as number) ?? SUB_DAY_CAP;
    const waitlisted = taken >= capacity;

    await supabase.from("subscription_slots").insert({
      user_id: userId,
      delivery_day: day,
      status: waitlisted ? "대기" : "신청",
      order_id: orderId,
    });

    results.push({
      deliveryDay: day,
      position: waitlisted ? waitlist + 1 : taken + 1,
      waitlisted,
    });
  }

  return results;
}
