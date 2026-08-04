// 단품 발송일 계산.
// 정책: 발송은 평일(월–금)만 가능, 공휴일 제외. 신청일 자정까지 접수분 기준.
//   - 평일(월~목) 신청 → 다음 날 발송
//   - 금·토·일 신청 → 다음 영업일인 월요일 발송
//   - 위로 정해진 발송일이 공휴일이면 다음 영업일로 미룬다(신선식품 — 공휴일 출고 시 상함).

import { isDispatchBlockedISO, isFarmClosureISO } from "./holidays";

const WEEKDAY_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 토·일·공휴일·목장 휴무일이면 다음 영업일까지 전진시킨다(d 를 직접 수정). */
export function advanceToBusinessDay(d: Date): void {
  while (d.getDay() === 0 || d.getDay() === 6 || isDispatchBlockedISO(toISODate(d))) {
    d.setDate(d.getDate() + 1);
  }
}

/** 그 날짜가 속한 배송 주의 월요일 ISO — 정기구독 '주' 단위 판정 기준. */
function weekStartISO(d: Date): string {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); // 일(0)→ -6, 월(1)→ 0 …
  return toISODate(m);
}

// 목장 휴무(하계 휴가 등)로 '그 주 배송이 통째로 없어지는' 회차인지.
//
//   정기구독은 요일 구독이다. 공휴일 하루가 끼면 같은 주 다음 영업일에 발송하면 되지만
//   (예: 8/17 광복절 대체공휴일 월요일분 → 8/18 화요일 발송 — 월·화가 같은 날 나간다),
//   목장이 그 주 내내 쉬면 그 주에는 발송할 날이 없다. 이때 다음 영업일로 밀면 휴무
//   직후 첫 영업일 하루에 월~금 전 요일이 몰리고, 월·화처럼 연속 두 회차의 발송일이
//   같은 날로 겹쳐 한 회차가 통째로 사라진다(고객은 결제한 회차를 못 받는다).
//   → 그 주 회차는 '다음 주 같은 요일'로 이월한다(총 회차 보존, 종료일만 한 주 밀림).
//     일시정지·이번주 건너뛰기와 같은 원칙이다.
//
//   판정: 회차 예정일이 목장 휴무일이고, 다음 발송 가능일이 '다음 배송 주'로 넘어가면 이월.
//   (휴무가 주 중간까지만이면 같은 주 다음 영업일에 발송 — 이월하지 않는다.)
export function closureDefersWeek(baseISO: string): boolean {
  if (!isFarmClosureISO(baseISO)) return false;
  const base = new Date(`${baseISO}T00:00:00`);
  const shifted = new Date(base);
  advanceToBusinessDay(shifted);
  return weekStartISO(shifted) > weekStartISO(base);
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

/** 회차 예정일 → 실제 배송일. 휴무 주 이월 후 주말·공휴일이면 다음 영업일로 시프트. */
export function subscriptionShipDate(baseISO: string): string {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + closureDeferDays(baseISO));
  advanceToBusinessDay(d);
  return toISODate(d);
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

// 주어진 배송요일(deliveryDay)의 그 주 배송일이 dateISO 인지 — 공휴일/주말이면 다음 영업일로 시프트.
//   슬롯 앵커가 아니라 '요일'만 보므로 멀티요일 슬롯(원주문/연장 요일 상이)도 정확하다.
//   ① 평소: dateISO 가 그 요일·평일 → {hits:true, shifted:false}
//   ② 공휴일 당일: 그 요일이지만 공휴일 → 전진 결과가 미래 → {hits:false}
//   ③ 시프트 도착일: 직전 그 요일이 공휴일이라 다음 영업일이 dateISO → {hits:true, shifted:true}
//   ④ 주말 dateISO: 전진 결과는 평일뿐 → hits:false
//   ⑤ 목장 휴무로 그 주가 통째로 막힌 회차: 다음 주 같은 요일로 이월되므로 이 주엔 발송 없음
//      → hits:false (이월분은 다음 주 그 요일을 평가할 때 ①로 잡힌다). closureDefersWeek 참고.
export function deliveryDayHitsDate(
  deliveryDay: string,
  dateISO: string
): { hits: boolean; shifted: boolean } {
  const target = SUB_DAY_NUM[deliveryDay];
  if (!target) return { hits: false, shifted: false };
  const cand = new Date(`${dateISO}T00:00:00`);
  let i = 0;
  while (cand.getDay() !== target && i < 7) {
    cand.setDate(cand.getDate() - 1);
    i++;
  }
  if (cand.getDay() !== target) return { hits: false, shifted: false };
  const candISO = toISODate(cand);
  if (closureDefersWeek(candISO)) return { hits: false, shifted: false };
  const shiftedDate = new Date(cand);
  advanceToBusinessDay(shiftedDate);
  const hits = toISODate(shiftedDate) === dateISO;
  return { hits, shifted: hits && candISO !== dateISO };
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
  return subscriptionShipDate(toISODate(firstSubscriptionDelivery(deliveryDay, from)));
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
