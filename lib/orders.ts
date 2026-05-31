import { getSupabase } from "./supabase";
import type { CartItem, DeliveryDay } from "./cart";
import type { SubPeriod } from "./products";

export type ShippingInfo = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  depositorName: string;
  memo: string;
  // 선물하기: isGift=true 이면 name/phone/address 는 받는 사람 정보,
  //   gifterName 은 보내는 분(주문자) 표시명, giftMessage 는 선물 메시지(선택).
  isGift?: boolean;
  gifterName?: string;
  giftMessage?: string;
};

// 신청 결과: 요일별로 몇 번째인지, 대기자인지.
export type SlotResult = {
  deliveryDay: DeliveryDay;
  position: number; // 해당 요일에서 몇 번째 (정원 내) 또는 대기자 순번
  waitlisted: boolean;
};

// 배송지 정보를 RPC(p_ship) 페이로드로 변환.
// 금액·발송일·슬롯은 모두 서버(DB)에서 권위 있게 산출하므로 여기서는 보내지 않는다.
function shipPayload(ship: ShippingInfo) {
  return {
    name: ship.name,
    phone: ship.phone,
    postcode: ship.postcode,
    address: ship.address,
    addressDetail: ship.addressDetail,
    depositorName: ship.depositorName,
    memo: ship.memo,
    isGift: ship.isGift === true,
    gifterName: ship.gifterName ?? null,
    giftMessage: ship.giftMessage ?? null,
  };
}

// 정기구독 주문 생성. 구독 기간(1/3/6/12개월) 전체분을 한 번에 무통장입금.
// 금액(병당 할인가·배송비·합계)·요일 슬롯 마감은 모두 서버(create_subscription_order RPC)에서
// product_catalog 권위값으로 재계산한다 → 브라우저가 보낸 금액은 신뢰하지 않는다(C1·C3).
export async function createOrder(
  items: CartItem[],
  period: SubPeriod,
  ship: ShippingInfo
): Promise<{ orderId: string; orderNo: string; slots: SlotResult[] }> {
  if (items.length === 0) throw new Error("장바구니가 비어 있습니다.");

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_subscription_order", {
    p_items: items.map((i) => ({
      product_id: i.productId,
      delivery_day: i.deliveryDay,
      qty: i.qty,
    })),
    p_period: period,
    p_ship: shipPayload(ship),
  });

  if (error || !data) {
    throw new Error(error?.message ?? "주문 생성에 실패했습니다.");
  }

  const slots: SlotResult[] = ((data.slots as SlotResult[]) ?? []).map((s) => ({
    deliveryDay: s.deliveryDay,
    position: s.position,
    waitlisted: s.waitlisted,
  }));

  return {
    orderId: data.order_id as string,
    orderNo: data.order_no as string,
    slots,
  };
}

// 단품(1회) 주문에 담는 항목. unitPrice 는 표시용이며 서버에서 다시 검증한다.
export type OnceItem = {
  productId: string;
  qty: number;
  unitPrice: number;
};

// 단품 1회 구매 주문 생성. 구독 슬롯은 등록하지 않으며, 발송일(ship_date)은 서버(KST)에서 산출한다.
// 금액·발송일은 create_once_order RPC 가 product_catalog 권위값으로 재계산한다(C1).
export async function createOnceOrder(
  items: OnceItem[],
  ship: ShippingInfo
): Promise<{ orderId: string; orderNo: string; shipDate: string }> {
  const filtered = items.filter((i) => i.qty > 0);
  if (filtered.length === 0) throw new Error("담은 제품이 없습니다.");

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_once_order", {
    p_items: filtered.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_ship: shipPayload(ship),
  });

  if (error || !data) {
    throw new Error(error?.message ?? "주문 생성에 실패했습니다.");
  }

  return {
    orderId: data.order_id as string,
    orderNo: data.order_no as string,
    shipDate: data.ship_date as string,
  };
}
