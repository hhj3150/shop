// 정기구독 배송 스케줄 계산 (날짜 기반, 주차별 레코드 없이 산출).
// 핵심: 총 배송 횟수(totalWeeks)는 보존하고, 일시정지로 '놓친 회차'만큼 잔여 배송일이 뒤로 밀린다.
//
// ★ 정지 보정의 기준은 '경과 일수'가 아니라 '놓친 회차 수'다.
//   경과 일수를 주 단위로 올리면(옛 규칙) 회차가 밀린다 — 두 방향 모두로 틀린다.
//     · 화요일 구독이 수요일에 정지 → 금요일 재개: 놓친 배송은 0회인데 경과 2일이 1주로
//       올림돼 전 회차가 한 주 밀린다(회차 1개를 공짜로 얹어 주고 종료일도 어긋난다).
//     · 휴배송 주(추석·하계휴무)를 끼고 정지 → 그 주는 원래 배송이 없는데도 정지 1주로
//       계산돼 손님이 결제한 회차를 한 번 덜 받는다.
//   그래서 정지 구간에 '실제로 놓인 배송 예정일'만 세어 그 수 × 7일을 민다.
//   SQL 도 같은 규칙이다(public.missed_delivery_weeks + sub_delivery_dates) — 화면·서버가
//   같은 회차를 말해야 환불액·배송명단·연장 블록 경계가 갈리지 않는다.

import { roundShipPlan } from "./ship-date";

const DAY_MS = 86_400_000;

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/** 일수를 주 단위(7의 배수)로 올린다. 정지 보정이 배송 요일을 흔들지 않게 하는 핵심. */
export function ceilToWeeks(days: number): number {
  return Math.ceil(Math.max(0, days) / 7) * 7;
}

export type SubInput = {
  startedAt: string | null; // 선택 요일 앵커(입금확인 시 부여). null이면 아직 시작 전.
  totalWeeks: number; // 총 배송 횟수 (= 주문 block_weeks)
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  // 첫 배송 공휴일 보정: 앵커(선택 요일)가 공휴일이면 1회차만 다음 영업일로 시프트한 실제 첫
  //   배송일. null/미지정이면 1회차 = 앵커(보정 불필요). 2회차+ 는 항상 앵커 요일 cadence.
  firstShipDate?: string | null;
};

export type SubSchedule = {
  started: boolean;
  paused: boolean;
  total: number;
  delivered: number;
  remaining: number;
  nextDate: string | null; // 다음 배송 예정일 (정지 중이거나 완료면 null)
  endDate: string | null; // 마지막(총 totalWeeks회째) 배송 예정일
  done: boolean;
};

/**
 * 회차 1..total 의 실제 배송일. 회차 k 의 기준일 = 앵커 + (k-1)주 + 정지일수 + 누적 이월일.
 * 그 기준일의 실제 발송일은 roundShipPlan(「한 회차는 그 주를 벗어나지 않는다」)이 정한다.
 *
 *   ★ 휴배송 이월은 뒤 회차 전체에 누적해야 한다 — 아니면 이월된 회차와 그 다음 회차가
 *     같은 날로 겹쳐 한 회차가 사라진다(2026 하계휴무 때 월요일 8/10·8/17 회차가 둘 다
 *     8/18 로 뭉갠 사고). 총 회차는 보존되고 종료일만 이월한 주 수만큼 밀린다.
 *   ★ 1회차는 앞당기지 않는다 — 앵커는 '입금확인 다음 날 이후'라, 앞당기면 아직 발송할 수
 *     없는(이미 지난) 날이 된다. 그 회차는 다음 주로 미룬다.
 *
 * SQL public.sub_delivery_dates(p_anchor, p_first, p_total, p_pdays) 와 1:1 이다.
 */
function buildDates(anchor: Date, total: number, pausedDays: number): Date[] {
  const dates: Date[] = [];
  let deferDays = 0;
  for (let k = 1; k <= total; k++) {
    const base = addDays(anchor, (k - 1) * 7 + pausedDays + deferDays);
    const plan = roundShipPlan(toISO(base), k === 1);
    deferDays += plan.deferDays; // 이월분은 뒤 회차 전체에 누적
    dates.push(parseISO(plan.ship));
  }
  return dates;
}

/** 반열림 구간 [from, to) 에 들어가는 배송일 수 — 정지 중 '놓친 회차' 계산용. */
function countBetween(dates: readonly Date[], from: Date, to: Date): number {
  return dates.filter((d) => d >= from && d < to).length;
}

/** from~to 를 덮는 주 수(올림). 정지 구간을 덮을 만큼 스케줄을 길게 뽑는 데 쓴다. */
function weeksSpan(from: Date, to: Date): number {
  return Math.ceil(Math.max(0, daysBetween(from, to)) / 7);
}

export function computeSchedule(input: SubInput, now: Date = new Date()): SubSchedule {
  const total = Math.max(0, input.totalWeeks);

  if (!input.startedAt) {
    return {
      started: false,
      paused: input.paused,
      total,
      delivered: 0,
      remaining: total,
      nextDate: null,
      endDate: null,
      done: false,
    };
  }

  const anchor = parseISO(input.startedAt); // 선택 요일 앵커(회차 cadence 기준).
  //   ※ input.firstShipDate(slots.first_ship_date)는 더 이상 쓰지 않는다. 그 값은 옛 규칙
  //     ('앵커가 공휴일이면 다음 영업일')로 저장된 것이라, 앞당김·휴배송이 들어간 지금 규칙과
  //     어긋난다. 1회차도 아래에서 앵커로부터 shipDateInWeek 로 직접 구한다 — 로스터
  //     (deliveryDayHitsDate)와 같은 함수를 쓰므로 두 화면이 갈릴 수 없다.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1) 정지가 끝난 뒤 확정된 정지일수(slots.paused_days)만 반영한 스케줄.
  //    재개 RPC 가 '놓친 회차 × 7일'만 적립하므로 이 값은 언제나 7의 배수다.
  //    (옛 데이터가 7의 배수가 아닐 수 있어 SQL pause_days_in_weeks 와 같게 올림해 둔다.)
  const settledDates = buildDates(anchor, total, ceilToWeeks(input.pausedDays));

  // 2) 지금 정지 중이면, 정지 시작일부터 기준일까지 '놓친 회차'를 센다 — 양끝 포함.
  //    정지 중인 슬롯은 그날 배송명단(buildRosterForDate)에서 빠지므로, 정지 구간 안에 놓인
  //    회차는 '기준일 당일'까지 모두 놓친 회차다. 여기서 기준일을 빼면 정지 중인데도 그날
  //    배송이 나간 것으로 집계돼 회차가 하나 앞질러 간다.
  //    재개는 반대다 — 재개일 당일은 이미 정지가 풀려 정상 발송되므로 재개 RPC 는
  //    [정지일, 재개일) 을 센다. 정지 마지막 날이 재개일 전날이라 두 구간은 정확히 맞물린다.
  //    이 수가 곧 재개 시 paused_days 에 적립될 주 수라, 정지 중 화면과 재개 후 스케줄이 같다.
  //
  //    ★ 세는 스케줄은 총 회차보다 길게 뽑는다. 남은 회차가 정지 구간보다 짧으면(예: 3회
  //      남기고 6주 정지) 총 회차까지만 센 수가 정지 기간보다 모자라, 밀어낸 회차 예정일이
  //      여전히 과거에 머문다 → 정지 중인데 delivered 가 다시 늘고, 재개하면 남은 회차가
  //      한꺼번에 '이미 배송됨'으로 삼켜진다. 요일 cadence 는 회차 수와 무관하므로
  //      구간을 덮을 만큼만 더 뽑아 세면 된다(휴배송 주는 그 주에 자리가 없어 자연히 빠진다).
  const missedWeeks =
    input.paused && input.pausedAt
      ? countBetween(
          buildDates(
            anchor,
            total + weeksSpan(parseISO(input.pausedAt), today) + 2,
            ceilToWeeks(input.pausedDays)
          ),
          parseISO(input.pausedAt),
          addDays(today, 1)
        )
      : 0;

  const dates =
    missedWeeks > 0
      ? buildDates(anchor, total, ceilToWeeks(input.pausedDays + missedWeeks * 7))
      : settledDates;
  const deliveryDate = (k: number) => dates[k - 1];

  let delivered = 0;
  for (let k = 1; k <= total; k++) {
    if (daysBetween(deliveryDate(k), today) >= 0) delivered += 1;
    else break;
  }

  const done = delivered >= total;
  const nextDate =
    !input.paused && !done ? toISO(deliveryDate(delivered + 1)) : null;
  const endDate = total > 0 ? toISO(deliveryDate(total)) : null;

  return {
    started: true,
    paused: input.paused,
    total,
    delivered,
    remaining: Math.max(0, total - delivered),
    nextDate,
    endDate,
    done,
  };
}
