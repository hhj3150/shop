import { getSupabase } from "./supabase";
import type { CartItem, DeliveryDay } from "./cart";
import type { SubPeriod } from "./products";
import { digitsOnly, type CashReceiptType } from "./cash-receipt";
import { normalizeBillingName } from "./depositor-name";
import type { DeliveryMethod } from "./delivery-method";

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
  // 현금영수증 — 발행 방식과 식별번호(소득공제: 휴대폰, 지출증빙: 사업자번호).
  cashReceiptType?: CashReceiptType;
  cashReceiptId?: string;
  // 수령방법: 택배(기본) | 방문수령. 방문수령이면 서버가 배송비 0 + 주소 미요구.
  deliveryMethod?: DeliveryMethod;
};

// 현금영수증 발행정보 저장(주문 생성 직후). '발행안함'은 컬럼 기본값과 같아 호출을 생략한다.
// 저장 실패가 주문 자체를 막지 않도록 별도 RPC로 분리하고 오류는 흡수한다
//   (예: 마이그레이션 적용 전 — 주문은 정상 접수되고 발행정보만 비어 후속 처리 가능).
async function saveCashReceipt(orderId: string, ship: ShippingInfo): Promise<void> {
  const type = ship.cashReceiptType;
  if (!type || type === "발행안함") return;
  const { error } = await getSupabase().rpc("set_cash_receipt", {
    p_order_id: orderId,
    p_type: type,
    p_id: digitsOnly(ship.cashReceiptId ?? ""),
  });
  if (error) {
    // 주문은 이미 생성됨 — 발행정보 저장 실패는 치명적이지 않다.
    console.error("현금영수증 저장 실패:", error.message);
  }
}

// 추천 적립금 사용 안 함(opt-out): 방금 자동 선차감된 적립금을 되돌린다.
//   입금대기 본인 주문만 대상이며 멱등. 복구된 금액(원)을 반환(되돌릴 게 없으면 0).
//   RPC 미적용·실패 시 0 을 반환해 호출 측이 차감 상태 그대로 진행하게 한다(안전).
export async function revokeReferralCredit(orderId: string): Promise<number> {
  try {
    const { data, error } = await getSupabase().rpc("revoke_referral_credit", {
      p_order_id: orderId,
    });
    if (error) {
      console.error("적립금 사용 취소 실패:", error.message);
      return 0;
    }
    return (data as number) ?? 0;
  } catch (e) {
    console.error("적립금 사용 취소 오류:", e);
    return 0;
  }
}

// 무통장입금 주문을 PayAction 에 등록(자동 입금확인 대상으로 감시 시작).
// 서버 라우트가 PAYACTION_API_KEY 로 등록을 수행한다. 실패는 non-fatal —
//   주문은 이미 생성되었으므로 등록 실패는 흡수하고 로깅만 한다(관리자 수동 처리 가능).
//   ordererPhone: 입금확인 문자 수신처(선물=보내는 분, 일반=주문자 연락처).
export async function registerPayActionDeposit(
  orderNo: string,
  ordererPhone: string
): Promise<void> {
  try {
    // keepalive: 완료 페이지로 라우팅·언마운트되는 도중에도 요청이 취소되지 않도록 유지.
    //   (fire-and-forget 호출이 router.push 로 abort 돼 서버 라우트에 도달조차 못 하던 문제 해결)
    await fetch("/api/payaction/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo, ordererPhone }),
      keepalive: true,
    });
  } catch (error) {
    console.error("PayAction 등록 호출 실패:", error);
  }
}

// 신청 결과: 요일별로 몇 번째인지, 대기자인지.
export type SlotResult = {
  deliveryDay: DeliveryDay;
  position: number; // 해당 요일에서 몇 번째 (정원 내) 또는 대기자 순번
  waitlisted: boolean;
};

// 결제창에 넘길 서버 권위 결제금액을 주문 생성 직후 DB에서 재조회한다.
// 브라우저가 계산한 금액은 신뢰하지 않는다 → PortOne totalAmount 는 이 값만 사용한다(C1·C3).
// total_amount 는 추천 적립금 차감 후 값이며, referral_credit_krw 는 차감액(표시용).
async function fetchOrderAmounts(
  orderId: string
): Promise<{ totalAmount: number; referralCreditKrw: number }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("total_amount,referral_credit_krw")
    .eq("id", orderId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "결제금액 조회에 실패했습니다.");
  }
  return {
    totalAmount: data.total_amount as number,
    referralCreditKrw: (data.referral_credit_krw as number) ?? 0,
  };
}

// 배송지 정보를 RPC(p_ship) 페이로드로 변환.
// 금액·발송일·슬롯은 모두 서버(DB)에서 권위 있게 산출하므로 여기서는 보내지 않는다.
function shipPayload(ship: ShippingInfo) {
  return {
    name: ship.name,
    phone: ship.phone,
    postcode: ship.postcode,
    address: ship.address,
    addressDetail: ship.addressDetail,
    // 입금자명은 PayAction 자동매칭 기준이므로 괄호 메모를 떼어 저장한다(통장 보내는분 이름과 정합).
    depositorName: normalizeBillingName(ship.depositorName),
    memo: ship.memo,
    isGift: ship.isGift === true,
    gifterName: ship.gifterName ?? null,
    giftMessage: ship.giftMessage ?? null,
    deliveryMethod: ship.deliveryMethod ?? "택배",
  };
}

// 정기구독 주문 생성. 구독 기간(1/2/3개월) 전체분을 한 번에 무통장입금.
// 금액(병당 할인가·배송비·합계)·요일 슬롯 마감은 모두 서버(create_subscription_order RPC)에서
// product_catalog 권위값으로 재계산한다 → 브라우저가 보낸 금액은 신뢰하지 않는다(C1·C3).
// idempotencyKey: 더블서밋 방어용 멱등키(체크아웃당 1회 생성·재시도 시 재사용).
//   같은 키로 재호출되면 RPC가 새 주문을 만들지 않고 기존 주문을 그대로 반환한다.
export async function createOrder(
  items: CartItem[],
  period: SubPeriod,
  ship: ShippingInfo,
  idempotencyKey: string
): Promise<{
  orderId: string;
  orderNo: string;
  slots: SlotResult[];
  totalAmount: number;
  referralCreditKrw: number;
}> {
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
    p_idempotency_key: idempotencyKey,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "주문 생성에 실패했습니다.");
  }

  const slots: SlotResult[] = ((data.slots as SlotResult[]) ?? []).map((s) => ({
    deliveryDay: s.deliveryDay,
    position: s.position,
    waitlisted: s.waitlisted,
  }));

  const orderId = data.order_id as string;
  await saveCashReceipt(orderId, ship);
  const amounts = await fetchOrderAmounts(orderId);
  return {
    orderId,
    orderNo: data.order_no as string,
    slots,
    totalAmount: amounts.totalAmount,
    referralCreditKrw: amounts.referralCreditKrw,
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
  ship: ShippingInfo,
  idempotencyKey: string
): Promise<{
  orderId: string;
  orderNo: string;
  shipDate: string;
  totalAmount: number;
  referralCreditKrw: number;
}> {
  const filtered = items.filter((i) => i.qty > 0);
  if (filtered.length === 0) throw new Error("담은 제품이 없습니다.");

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_once_order", {
    p_items: filtered.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_ship: shipPayload(ship),
    p_idempotency_key: idempotencyKey,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "주문 생성에 실패했습니다.");
  }

  const orderId = data.order_id as string;
  await saveCashReceipt(orderId, ship);
  const amounts = await fetchOrderAmounts(orderId);
  return {
    orderId,
    orderNo: data.order_no as string,
    shipDate: data.ship_date as string,
    totalAmount: amounts.totalAmount,
    referralCreditKrw: amounts.referralCreditKrw,
  };
}

// 비회원(게스트) 단품 1회 주문. 로그인 없이 생성하며, 게스트는 RLS로 자기 주문을
// 조회할 수 없으므로 결제금액(total_amount)은 RPC 반환값을 그대로 신뢰한다(서버 권위값).
// 현금영수증은 set_cash_receipt(로그인 필요)를 못 쓰므로 p_ship 에 실어 RPC가 함께 기록한다.
export async function createGuestOnceOrder(
  items: OnceItem[],
  ship: ShippingInfo,
  idempotencyKey: string
): Promise<{
  orderId: string;
  orderNo: string;
  shipDate: string;
  totalAmount: number;
  referralCreditKrw: number;
}> {
  const filtered = items.filter((i) => i.qty > 0);
  if (filtered.length === 0) throw new Error("담은 제품이 없습니다.");

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("create_guest_once_order", {
    p_items: filtered.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_ship: {
      ...shipPayload(ship),
      cashReceiptType: ship.cashReceiptType ?? "발행안함",
      cashReceiptId: ship.cashReceiptId ?? null,
    },
    p_idempotency_key: idempotencyKey,
  });

  if (error || !data) {
    throw new Error(error?.message ?? "주문 생성에 실패했습니다.");
  }

  return {
    orderId: data.order_id as string,
    orderNo: data.order_no as string,
    shipDate: data.ship_date as string,
    totalAmount: data.total_amount as number,
    referralCreditKrw: 0, // 게스트는 계정이 없어 적립금 차감 대상 아님.
  };
}
