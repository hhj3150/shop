// 배송완료 안내 문자를 보낼 회차인지 판정(순수, I/O 없음).
//
//   배경(2026-08-28 실사고): 관리자가 배송판을 정리하려고 지난 회차들을 한꺼번에
//   '배송완료'로 전환하자, 6~8주 전에 이미 받은 배송에 대해 "상품이 배송 완료되었습니다"
//   문자가 123건 한 번에 나갔다. 구독이 끝난 손님·6월에 한 번 사고 만 단품 손님까지
//   받아, 손님 입장에선 '끝났는데 문자가 계속 오는' 것으로 보였다.
//
//   규칙: 그 회차 발송일로부터 DELIVERED_NOTICE_MAX_DAYS 이내일 때만 안내한다.
//     지난 기록 정리(백필)는 상태만 기록하고 문자는 보내지 않는다.
//     발송일을 알 수 없으면(수기 전환 등) 기존대로 보낸다 — 정상 1건 누락을 막는다.
//   실측: 정상 운영의 도착확인은 발송 0~4일 뒤에 몰려 있다(39건). 21일 이상은 전부 백필이었다.

export const DELIVERED_NOTICE_MAX_DAYS = 7;

// KST 달력일(UTC epoch 정규화). KST는 DST 없는 UTC+9.
function dayEpoch(iso: string): number | null {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

// shipISO = 그 회차 발송일(YYYY-MM-DD, 없으면 null), todayISO = 오늘(KST).
export function shouldNotifyDelivered(
  shipISO: string | null | undefined,
  todayISO: string,
  maxDays: number = DELIVERED_NOTICE_MAX_DAYS
): boolean {
  if (!shipISO) return true; // 발송일 미상 — 보수적으로 안내(누락 방지)
  const ship = dayEpoch(shipISO);
  const today = dayEpoch(todayISO);
  if (ship == null || today == null) return true;
  const days = Math.round((today - ship) / 86_400_000);
  if (days < 0) return true; // 미래 발송일(선처리) — 안내 유지
  return days <= maxDays;
}
