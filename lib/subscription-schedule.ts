// 정기구독 배송 스케줄 계산 (날짜 기반, 주차별 레코드 없이 산출).
// 핵심: 총 배송 횟수(totalWeeks)는 보존하고, 일시정지한 일수만큼 모든 잔여 배송일이 뒤로 밀린다.
// 정지 중에는 누적 정지일이 매일 늘어 다음 배송일도 같이 밀리므로 발송 완료 수가 자연히 멈춘다.

import { advanceToBusinessDay, closureDeferDays } from "./ship-date";
import { isFarmClosureISO } from "./holidays";

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

  const anchor = parseISO(input.startedAt); // 선택 요일 앵커(2회차+ cadence 기준).
  // 1회차 기준일. first_ship_date 는 서버가 '앵커가 공휴일이면 다음 영업일'로 계산해 둔 값인데,
  //   앵커가 목장 휴무일이면 그 보정값(휴무 직후 첫 영업일)은 아래 '그 주 이월' 규칙과 어긋난다
  //   → 그 경우엔 앵커에서 다시 계산한다(로스터 deliveryDayHitsDate 와 같은 날짜를 내기 위함).
  const firstBase =
    input.firstShipDate && !isFarmClosureISO(input.startedAt)
      ? parseISO(input.firstShipDate)
      : anchor;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const currentPauseDays =
    input.paused && input.pausedAt
      ? Math.max(0, daysBetween(parseISO(input.pausedAt), today))
      : 0;
  // ★ 정지 일수는 '주(회차) 단위'로 올려 적용한다.
  //   정기구독은 요일 구독이다. 실제 발송(buildRosterForDate)은 order_items.delivery_day 요일에
  //   붙어 있는데, 정지 일수를 날 단위로 그대로 더하면 앵커 cadence 가 그 요일에서 벗어난다
  //   (예: 월요일 구독이 3일 정지 → 회차 예정일이 목요일로 이동). 그러면
  //     · 화면·문자의 '다음 배송일'이 손님이 실제로 받는 요일과 달라지고,
  //     · delivered/종료일이 실제 발송 횟수와 어긋나 마지막 회차가 사라지거나(회차 소실)
  //       연장 블록 경계가 한 주 밀려 엉뚱한 구성품이 나간다.
  //   올림(ceil)이라 종료일은 정지한 기간 이상으로만 밀린다 — 총 회차는 언제나 보존되고,
  //   손님이 결제한 회차를 못 받는 방향으로는 절대 어긋나지 않는다.
  //   (1주 건너뛰기는 정확히 +7일을 적립하므로 올림의 영향이 없다.)
  const totalPausedDays = ceilToWeeks(input.pausedDays + currentPauseDays);

  // 1..total 회차의 실제 배송일을 한 번에 산출한다.
  //   1회차는 firstBase, 2회차+ 는 앵커 요일 cadence(앵커 + (k-1)주). 여기에 누적 정지일과
  //   누적 이월일(deferDays)을 더한 뒤 주말·공휴일이면 다음 영업일로 시프트한다.
  //
  //   ★ 목장 휴무 주 이월(closureDefersWeek): 회차 예정일이 목장 휴무에 걸려 그 주에 발송할
  //     날이 없으면 그 회차를 다음 주 같은 요일로 미룬다. 이월분은 뒤 회차 전체에 누적 적용해야
  //     한다 — 아니면 이월된 회차와 그 다음 회차가 같은 날로 겹쳐 한 회차가 사라진다.
  //     (예: 2026 하계휴무 — 월요일 구독의 8/10·8/17 회차가 둘 다 8/18 로 뭉개졌다.)
  //     총 회차는 보존되고 종료일만 이월한 주 수만큼 밀린다(일시정지·건너뛰기와 같은 원칙).
  const dates: Date[] = [];
  let deferDays = 0;
  for (let k = 1; k <= total; k++) {
    let base =
      k === 1
        ? addDays(firstBase, totalPausedDays + deferDays)
        : addDays(anchor, (k - 1) * 7 + totalPausedDays + deferDays);
    const add = closureDeferDays(toISO(base));
    if (add > 0) {
      deferDays += add;
      base = addDays(base, add);
    }
    advanceToBusinessDay(base); // addDays 는 새 Date → 변이 안전
    dates.push(base);
  }
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
