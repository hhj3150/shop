// 단품 발송일 계산.
// 정책: 신청일 자정까지 접수분은 "다음 날" 발송. 단, 발송은 월–금만 가능하므로
//       다음 날이 토/일이면 그 다음 월요일로 미룬다.
//   예) 금요일 신청 → 토(발송X)·일(발송X) → 월요일 발송
//       토요일 신청 → 일(발송X) → 월요일 발송

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** now(기본: 현재) 기준 발송 예정일을 Date(자정)로 반환. */
export function nextDispatchDate(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1); // 다음 날
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2); // 토 → 월
  else if (day === 0) d.setDate(d.getDate() + 1); // 일 → 월
  return d;
}

/** 'YYYY-MM-DD' (DB 저장용). */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'M월 D일 (요일)' (표시용). */
export function formatDispatch(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY_KR[d.getDay()]})`;
}
