// 배송 페이지의 행 단위 '출고·발송' 결정 로직(순수).
//   재고 차감(shipment_log)과 별개로, 그 주문 행에 송장·택배사·발송일·상태를
//   어떻게 반영하고 발송 문자를 보낼지 정한다. 행 출고·일괄 발송 두 경로가 공유한다.
//
// ★ 송장번호는 '보냈다'의 증거가 아니라 '추적'의 수단이다 — 둘을 묶지 않는다.
//   예전엔 송장이 없으면 patch 를 만들지 않아 배송판이 출고 자체를 막았다. 그런데 목장은
//   로젠 프로그램에서 송장을 뽑고 쇼핑몰에 또 입력하는 이중 입력 구조라, 현장에서 그 입력이
//   빠지면 출고가 통째로 기록되지 않았다(stock_ship_out 도 호출 전에 막혔다).
//   그 결과 실제로는 나간 회차가 shipment_log 에 없어 '안 보낸 회차'로 남았다.
//   → 송장 없이도 출고·발송으로 처리한다. 송장은 있으면 싣고, 없으면 나중에 채운다.
//   (발송 문자는 이미 송장 없는 경우를 감당한다 — 본문은 택배사만, 알림톡은 LMS 로 폴백.)
export const SHIP_STATUS = "배송중";

// orders 테이블 부분 갱신 패치.
//   tracking_no 는 없을 수 있다(null). DB 도 nullif(trim(...),'') 로 빈 값을 NULL 로 받는다.
export type ShipOutPatch = {
  courier: string;
  tracking_no: string | null;
  shipped_at: string;
  status: string;
};

export type ShipOutDecision = {
  patch: ShipOutPatch; // 항상 생성 — 송장 유무와 무관하게 '보냈다'는 기록한다
  notifyShipped: boolean; // 새로 '배송중'으로 전환될 때만 true(중복 문자 방지)
  hasTracking: boolean; // 송장 없이 나간 건을 화면에서 짚어 주기 위한 표시
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
  return {
    patch: {
      courier: input.courier,
      tracking_no: tracking === "" ? null : tracking,
      shipped_at: input.shipped_at ?? input.shipISO, // 이미 기록됐으면 보존
      status: SHIP_STATUS,
    },
    // 발송 문자는 '회차마다 1번' 나가야 한다. 구독 2회차도 status 는 직전 회차 때문에
    //   이미 '배송중'이라, status 만으로 막으면 회차 문자가 영영 누락된다.
    //   → 이번 회차가 새 발송(미출고)이거나, 출고는 됐지만 아직 '배송중' 전환 전이면 보낸다.
    //   이미 출고됐고 '배송중'인 '같은 회차'의 재저장만 중복 발송을 막는다.
    notifyShipped: !(input.alreadyShipped === true && input.status === SHIP_STATUS),
    hasTracking: tracking !== "",
  };
}
