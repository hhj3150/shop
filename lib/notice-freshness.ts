// '지난 배송'에 대한 안내 문자를 막는 신선도 규칙(순수, I/O 없음).
//
//   배경(2026-08-28 실사고): 관리자가 배송판에 밀려 있던 지난 회차를 한꺼번에
//   '배송완료'로 정리하자, 6~8주 전에 이미 받은 배송에 "상품이 배송 완료되었습니다"
//   문자가 6분 동안 123건 나갔다(그중 85건이 발송 7일 초과). 구독이 끝난 손님과
//   6월에 한 번 산 단품 손님까지 받아, 손님에겐 '끝났는데 문자가 계속 오는' 일이 됐다.
//
//   규칙: 발송·배송완료 안내는 '그 물건이 실제로 나간 시점'이 MAX_DAYS 이내일 때만 보낸다.
//     지난 기록을 정리·백필하는 작업은 상태만 남기고 문자는 보내지 않는다.
//
//   ★ 기준 시각은 '실제 출고 시각'(shipment_log.shipped_at = 송장을 기록한 순간)이다.
//     예정 발송일(ship_date)로 재면, 8/20 예정분을 8/28에 뒤늦게 보낸 이월 건이
//     '8일 지난 배송'으로 잘못 걸려 정상 발송 안내가 누락된다.
//
//   실측 근거: 정상 운영의 도착확인은 출고 0~4일 뒤에 몰려 있었고(39건),
//     21일 이상은 전부 백필이었다. 7일이면 정상 운영을 한 건도 막지 않는다.

export const NOTICE_MAX_DAYS = 7;

// KST 달력일(UTC epoch 정규화). KST는 DST 없는 UTC+9.
function kstDayEpoch(ts: string): number | null {
  // 'YYYY-MM-DD' 는 그대로, timestamptz 는 KST 로 옮겨 달력일을 취한다.
  const iso =
    ts.length <= 10
      ? ts.slice(0, 10)
      : new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
}

// dispatchedAt = 실제 출고 시각(timestamptz) 또는 발송일('YYYY-MM-DD'). 모르면 null.
// todayISO = 오늘(KST, 'YYYY-MM-DD').
export function isNoticeFresh(
  dispatchedAt: string | null | undefined,
  todayISO: string,
  maxDays: number = NOTICE_MAX_DAYS
): boolean {
  if (!dispatchedAt) return true; // 출고 시점 미상 — 보수적으로 보낸다(정상 1건 누락 방지)
  const shipped = kstDayEpoch(dispatchedAt);
  const today = kstDayEpoch(todayISO);
  if (shipped == null || today == null) return true;
  const days = Math.round((today - shipped) / 86_400_000);
  if (days < 0) return true; // 미래(선처리) — 안내 유지
  return days <= maxDays;
}
