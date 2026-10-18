// 연장 알림(입금 안내·입금 확인)을 '누구에게' 보낼지 고른다.
//
//   [왜 따로 두나]
//     이 둘은 돈 이야기다 — "입금하실 금액 120,000원", "입금이 확인되었습니다".
//     돈을 내는 사람은 언제나 구독을 신청한 회원이다. 받는 사람이 아니다.
//
//   [실제로 난 사고 — 2026-10 운영 DB 확인]
//     연장 알림이 orders.ship_phone 으로 나갔다. 일반 주문은 ship_phone 이 곧 회원
//     번호라 문제가 없었는데, 선물 구독은 ship_phone 이 '받는 분' 번호다.
//     그래서 선물 받으신 분 5분에게 "구독 연장 신청이 접수되었습니다. 입금하실 금액
//     ○○원, 농협 ..." 문자가 갔다. 신청한 적도 없는 분들이 입금 요청을 받았고,
//     정작 돈을 내야 할 구매자는 안내를 못 받았다.
//     (5건 모두 받는분 번호 ≠ 구매자 번호였고, sms_log 에 발송 기록이 남아 있다)
//
//   선물 여부를 보지 않는다. '연장 알림은 회원에게'가 유일한 규칙이면 선물 플래그가
//   누락돼도(실제로 누락돼 있었다) 수신자는 틀리지 않는다.

// DB 에서 온 값은 null 이 섞인다 — 호출처가 매번 달래지 않게 여기서 받아 준다.
export type NoticeParty = { name?: string | null; phone?: string | null };

export type RenewalNoticeTarget = { phone: string; name: string; fallback: boolean };

/**
 * 연장 알림 수신자. 회원(구매자)이 원칙이고, 회원 번호를 모를 때만 배송지 번호로 떨어진다.
 *
 * ★ 폴백을 두는 이유: 번호가 없다고 안내를 통째로 안 보내면 손님은 입금 계좌를 못 받는다.
 *   잘못 가는 것보다 안 가는 게 나은 경우가 있고 아닌 경우가 있는데, 입금 안내는 후자다.
 *   다만 폴백으로 갔다는 사실은 남겨서(fallback) 운영 쪽에서 뒤늦게라도 알 수 있게 한다.
 */
export function renewalNoticeTarget(
  buyer: NoticeParty | null | undefined,
  ship: NoticeParty | null | undefined
): RenewalNoticeTarget | null {
  const buyerPhone = digits(buyer?.phone);
  if (buyerPhone) {
    return { phone: buyerPhone, name: pickName(buyer?.name, ship?.name), fallback: false };
  }
  const shipPhone = digits(ship?.phone);
  if (shipPhone) {
    return { phone: shipPhone, name: pickName(buyer?.name, ship?.name), fallback: true };
  }
  return null;
}

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/[^0-9]/g, "");
}

// 인사말은 회원 이름으로. 회원 이름을 모를 때만 배송지 이름을 쓴다
//   (선물이면 배송지 이름은 받는 분이라, 구매자에게 '어머니님,' 으로 인사하게 된다).
function pickName(buyerName: string | null | undefined, shipName: string | null | undefined): string {
  return (buyerName ?? "").trim() || (shipName ?? "").trim() || "고객";
}
