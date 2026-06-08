// 배송 페이지의 행 단위 '출고·발송' 결정 로직(순수).
//   재고 차감(shipment_log)과 별개로, 그 주문 행에 송장·택배사·발송일·상태를
//   어떻게 반영하고 발송 문자를 보낼지 정한다. 행 출고·일괄 발송 두 경로가 공유한다.
export const SHIP_STATUS = "배송중";

// orders 테이블 부분 갱신 패치(송장이 있을 때만 생성).
export type ShipOutPatch = {
  courier: string;
  tracking_no: string;
  shipped_at: string;
  status: string;
};

export type ShipOutDecision = {
  patch: ShipOutPatch | null; // null이면 주문 갱신 없이 재고만 출고
  notifyShipped: boolean; // 새로 '배송중'으로 전환될 때만 true(중복 문자 방지)
};

export function decideShipOut(input: {
  status: string;
  shipped_at: string | null;
  courier: string;
  trackingNo: string;
  shipISO: string;
}): ShipOutDecision {
  const tracking = input.trackingNo.trim();
  // 송장이 없으면 발송으로 보지 않는다 — 재고만 출고하고 주문은 건드리지 않음.
  if (!tracking) {
    return { patch: null, notifyShipped: false };
  }
  return {
    patch: {
      courier: input.courier,
      tracking_no: tracking,
      shipped_at: input.shipped_at ?? input.shipISO, // 이미 기록됐으면 보존
      status: SHIP_STATUS,
    },
    // 이미 배송중이면(구독 다음 주차 재출고 등) 문자를 다시 보내지 않는다.
    notifyShipped: input.status !== SHIP_STATUS,
  };
}
