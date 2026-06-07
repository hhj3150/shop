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

// 정기구독 첫 배송일: 신청(또는 입금확인) 다음 날부터 가능, 선택한 요일의 가장 가까운 날.
// 전날 자정까지 접수분만 다음 날 배송이 되므로 최소 +1일부터 탐색한다.
const SUB_DAY_NUM: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

export function firstSubscriptionDelivery(
  deliveryDay: string,
  from: Date = new Date()
): Date {
  const target = SUB_DAY_NUM[deliveryDay] ?? 1;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1); // 전날 자정 마감 → 최소 다음 날부터
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  return d;
}

// 기준일(baseISO, 그날 포함) 이후 가장 가까운 해당 요일 배송일 ISO.
//   구독 시작일 연기/지정용: started_at 을 미래 요일로 맞춘다.
//   firstSubscriptionDelivery 는 from '다음 날'부터 탐색하므로, 기준일 '포함'을 위해
//   하루 전을 넘긴다.
export function firstDeliveryOnOrAfter(deliveryDay: string, baseISO: string): string {
  const base = new Date(`${baseISO}T00:00:00`);
  base.setDate(base.getDate() - 1);
  return toISODate(firstSubscriptionDelivery(deliveryDay, base));
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
