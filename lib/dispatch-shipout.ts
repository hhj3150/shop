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
  // 이번 회차(주문|발송일)가 이미 출고된 상태인지. 구독은 같은 주문 행을 회차마다
  //   재출고하므로 status 만으로는 '새 회차'인지 '같은 회차 재저장'인지 구분할 수 없다.
  //   호출자가 회차 단위 출고 이력(shipment_log)으로 판정해 넘긴다. (기본 false)
  alreadyShipped?: boolean;
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
    // 발송 문자는 '회차마다 1번' 나가야 한다. 구독 2회차도 status 는 직전 회차 때문에
    //   이미 '배송중'이라, status 만으로 막으면 회차 문자가 영영 누락된다.
    //   → 이번 회차가 새 발송(미출고)이거나, 출고는 됐지만 아직 '배송중' 전환 전
    //     (송장 누락으로 입금확인에 묶인 건)이면 보낸다.
    //   이미 출고됐고 '배송중'인 '같은 회차'의 재저장만 중복 발송을 막는다.
    notifyShipped: !(input.alreadyShipped === true && input.status === SHIP_STATUS),
  };
}
