// 단품 발송일 계산.
// 정책: 발송은 월–금만 가능. 신청일 자정까지 접수분 기준.
//   - 평일(월~목) 신청 → 다음 날 발송
//   - 금요일 신청 → 다음 날(토)은 발송X → 월요일 발송
//   - 토·일 신청 → 주말엔 입금확인·포장 불가 → 월요일 접수분으로 보고 화요일 발송

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** now(기본: 현재) 기준 발송 예정일을 Date(자정)로 반환. */
export function nextDispatchDate(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const orderDay = d.getDay(); // 0=일 … 6=토

  if (orderDay === 6) {
    d.setDate(d.getDate() + 3); // 토 → 화
  } else if (orderDay === 0) {
    d.setDate(d.getDate() + 2); // 일 → 화
  } else {
    d.setDate(d.getDate() + 1); // 평일 → 다음 날
    if (d.getDay() === 6) d.setDate(d.getDate() + 2); // 금 신청분: 토 → 월
  }
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
