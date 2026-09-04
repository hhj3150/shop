// 발송일 계산 — 단품(주문 기준)과 정기구독(요일 기준) 공용.
//
// 정기구독 발송일 규칙 — 「한 회차는 그 주(월~금)를 벗어나지 않는다」
//   정기구독은 요일 구독이다. 한 회차가 다른 주로 넘어가면 그 주는 배송이 없고 다음 주에
//   두 회차가 몰려, 손님은 열흘 굶다가 이틀 만에 두 번 받는다. 그래서 회차 예정일이
//   공휴일·목장 휴무에 걸리면 '같은 주 안에서' 해결하고, 그 주에 방법이 없으면 그 주를
//   통째로 쉬고 다음 주 같은 요일로 이월한다(총 회차 보존, 종료일만 한 주 밀림).
//
//     ① 그날 발송 가능        → 그날
//     ② 같은 주 뒤쪽에 영업일  → 가장 이른 그 날 (미루기)
//         예) 2026-10-05(월, 개천절 대체) → 10-06(화). 그날 화요일분과 함께 나간다.
//     ③ 같은 주 앞쪽에 영업일  → 가장 늦은 그 날 (앞당김)
//         예) 2026-10-09(금, 한글날) → 10-08(목). 그날 목요일분과 함께 나간다.
//             (뒤로 밀면 10-12 월요일 — 주를 넘어 간격이 10일·4일로 무너진다.)
//     ④ 그 주에 영업일이 없음  → 휴배송, 다음 주 같은 요일로 이월
//         예) 2026 추석 주(9/21~9/25 목장 휴무) → 9/29·9/30·10/1·10/2 로 각각 이월.
//
//   ★ 1회차만 예외: 앞당기지 않는다(computeSchedule). 앵커는 '입금확인 다음 날 이후'라
//     앞당기면 아직 발송할 수 없는 날이 된다 → 그 회차는 다음 주로 미룬다.
//
// 단품 발송일 정책: 신청일 자정까지 접수분 기준.
//   - 평일(월~목) 신청 → 다음 날 발송 / 금·토·일 신청 → 다음 영업일인 월요일 발송
//   - 정해진 발송일이 공휴일이면 다음 영업일로 미룬다(앞당김 없음 — 주문 전으로 갈 수 없다).

import { isDispatchBlockedISO } from "./holidays";

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 토·일·공휴일·목장 휴무일이면 다음 영업일까지 전진시킨다(d 를 직접 수정). */
export function advanceToBusinessDay(d: Date): void {
  while (d.getDay() === 0 || d.getDay() === 6 || isDispatchBlockedISO(toISODate(d))) {
    d.setDate(d.getDate() + 1);
  }
}

// 회차 예정일(baseISO)의 실제 발송일 — 「한 회차는 그 주를 벗어나지 않는다」.
//   ① 그날 가능 → 그날  ② 같은 주 뒤쪽 영업일 → 가장 이른 날(미루기)
//   ③ 같은 주 앞쪽 영업일 → 가장 늦은 날(앞당김)  ④ 그 주에 영업일 없음 → null(다음 주 이월)
//   파일 상단 주석의 규칙 전문 참고. 로스터(deliveryDayHitsDate)·회차 계산(computeSchedule)·
//   SQL(ship_date_in_week) 이 모두 이 한 규칙을 쓴다.
export function shipDateInWeek(baseISO: string): string | null {
  const base = new Date(`${baseISO}T00:00:00`);
  const monday = new Date(base);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  // 그 주 월~금 5일의 발송 가능 여부.
  const week: { iso: string; open: boolean }[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = toISODate(d);
    week.push({ iso, open: !isDispatchBlockedISO(iso) });
  }

  const baseIdx = week.findIndex((w) => w.iso === baseISO);
  if (baseIdx < 0) return null; // 주말 기준일 — 정기 회차는 평일 앵커만 쓴다.

  if (week[baseIdx].open) return week[baseIdx].iso; // ①
  for (let i = baseIdx + 1; i < 5; i++) if (week[i].open) return week[i].iso; // ② 미루기
  for (let i = baseIdx - 1; i >= 0; i--) if (week[i].open) return week[i].iso; // ③ 앞당김
  return null; // ④ 그 주 통째로 휴배송
}

// 그 주에 발송할 수 있는 날이 하루도 없어 회차가 통째로 다음 주로 이월되는가.
//
//   정기구독은 요일 구독이다. 그 주 안에 하루라도 영업일이 있으면 ②·③으로 그 주에 보낸다.
//   하루도 없으면(하계 휴가 주, 추석 연휴 주처럼) 그 주는 쉬고 회차를 다음 주 같은 요일로
//   옮긴다 — 총 회차는 보존되고 종료일만 한 주 밀린다(일시정지·건너뛰기와 같은 원칙).
//   ★ 다음 영업일로 밀어버리면 휴무 직후 하루에 여러 요일분이 몰리고, 연속 두 회차의
//     발송일이 같은 날로 겹쳐 한 회차가 통째로 사라진다(고객은 결제한 회차를 못 받는다).
export function closureDefersWeek(baseISO: string): boolean {
  return shipDateInWeek(baseISO) === null;
}

/**
 * 회차 예정일(baseISO)에 더해야 할 이월 일수(7의 배수, 이월 없으면 0).
 * 연속 휴무 주에도 안전하도록 반복하며, guard 로 무한루프를 막는다.
 * computeSchedule 은 이 값을 '이후 회차 전체'에 누적해 회차끼리 날짜가 겹치지 않게 한다.
 */
export function closureDeferDays(baseISO: string): number {
  let days = 0;
  const d = new Date(`${baseISO}T00:00:00`);
  for (let guard = 0; guard < 60 && closureDefersWeek(toISODate(d)); guard++) {
    days += 7;
    d.setDate(d.getDate() + 7);
  }
  return days;
}

/**
 * 회차 예정일 → 실제 발송일 + 이월 일수. 회차 날짜 산출의 단일 구현.
 *   그 주에 발송할 날이 없으면(④) 다음 주 같은 요일로 이월하며, 이월 일수를 함께 돌려준다
 *   (computeSchedule 이 뒤 회차 전체에 누적해야 회차끼리 날짜가 겹치지 않는다).
 *   noPullForward=true 면 앞당김(③)을 쓰지 않고 다음 주로 미룬다 — 1회차 전용.
 *   1회차의 앵커는 '입금확인 다음 날 이후'라, 앞당기면 아직 발송할 수 없는 날이 되기 때문.
 */
export function roundShipPlan(
  baseISO: string,
  noPullForward = false
): { ship: string; deferDays: number } {
  const d = new Date(`${baseISO}T00:00:00`);
  for (let guard = 0, defer = 0; guard < 60; guard++, defer += 7) {
    const iso = toISODate(d);
    const ship = shipDateInWeek(iso);
    if (ship != null && !(noPullForward && ship < iso)) return { ship, deferDays: defer };
    d.setDate(d.getDate() + 7);
  }
  return { ship: toISODate(d), deferDays: 0 };
}

/** 회차 예정일 → 실제 배송일(표시용). 휴배송 주는 다음 주 같은 요일로 이월한다. */
export function subscriptionShipDate(baseISO: string): string {
  return roundShipPlan(baseISO).ship;
}

/** now(기본: 현재) 기준 발송 예정일을 Date(자정)로 반환. */
export function nextDispatchDate(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // 신청 다음 날을 최소 발송일로 잡고, 주말·공휴일이면 다음 영업일로 전진.
  //   → 월~목은 다음 날, 금(→토)·토(→일)·일은 자연히 월요일로 모인다.
  d.setDate(d.getDate() + 1);
  advanceToBusinessDay(d);
  return d;
}

// 정기구독 첫 배송일: 신청(또는 입금확인) 다음 날부터 가능, 선택한 요일의 가장 가까운 날.
// 전날 자정까지 접수분만 다음 날 배송이 되므로 최소 +1일부터 탐색한다.
const SUB_DAY_NUM: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

// 이 배송요일의 회차가 dateISO 에 나가는가 — 요일 매칭의 단일 규칙.
//   dateISO 가 속한 배송 주(월~금)에서 그 요일의 기준일을 잡고, shipDateInWeek 로 실제
//   발송일을 구해 dateISO 와 비교한다. 규칙상 발송일은 언제나 기준일과 같은 주에 있으므로
//   (그 주에 못 보내면 다음 주로 이월되고, 그건 다음 주 기준일이 처리한다) 이 한 번의
//   비교로 미루기(②)·앞당김(③)·휴배송(④)이 모두 정확히 걸러진다.
//     shifted = 원래 요일이 아닌 날에 나가는 회차(전날 예고 문자에서 안내에 쓴다).
export function deliveryDayHitsDate(
  deliveryDay: string,
  dateISO: string
): { hits: boolean; shifted: boolean } {
  const target = SUB_DAY_NUM[deliveryDay];
  if (!target) return { hits: false, shifted: false };
  const d = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { hits: false, shifted: false };
  const monday = new Date(d);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const base = new Date(monday);
  base.setDate(monday.getDate() + (target - 1));
  const baseISO = toISODate(base);
  const ship = shipDateInWeek(baseISO);
  const hits = ship === dateISO;
  return { hits, shifted: hits && ship !== baseISO };
}

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

// 지금(또는 from) 신청하면 첫 배송이 실제로 언제인지 — 표시 전용.
//   firstSubscriptionDelivery 는 '앵커(선택 요일)'만 찾는다. 앵커는 요일 cadence 의 기준이라
//   공휴일·휴무 보정을 하지 않는다(보정하면 주기가 깨진다). 고객·관리자에게 보여줄 첫 배송일은
//   computeSchedule 1회차와 같은 규칙(휴무 주 이월 → 다음 영업일)으로 계산해야 한다.
export function firstShipDateFor(deliveryDay: string, from: Date = new Date()): string {
  // 1회차는 앞당기지 않는다 — computeSchedule 의 1회차 규칙과 같은 값이어야 한다
  //   (여기서 앞당긴 날짜를 안내하면 손님에게 이미 지난 날짜를 첫 배송일로 알리게 된다).
  return roundShipPlan(toISODate(firstSubscriptionDelivery(deliveryDay, from)), true).ship;
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
