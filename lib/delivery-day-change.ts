// 정기구독 배송요일 변경 — 앵커(started_at) 재계산 (순수, I/O 없음).
//
//   왜 앵커를 옮겨야 하나:
//     이 시스템은 구독을 두 축으로 본다.
//       · 회차 계산(computeSchedule): 앵커 + (k-1)주 → 몇 회차까지 나갔는지·종료일·환불액.
//       · 실제 발송일(buildRosterForDate): order_items.delivery_day 요일에 맞는 날짜.
//     둘은 '앵커도 그 요일'이라는 전제로만 맞물린다. 요일만 바꾸고 앵커를 두면 최대 나흘이
//     어긋나, 마지막 회차가 종료일을 넘겨 사라지거나(회차 소실) 첫 회차가 시작 전으로 밀린다.
//
//   규칙:
//     앵커를 요일 차이(δ)만큼 옮기되, 그 결과로 '이미 나간 회차 수'가 달라지면 안 된다.
//       · δ만큼 뒤로 옮기면 이번 주 회차가 미래로 밀려 이미 받은 회차가 다시 나갈 수 있고,
//       · δ만큼 앞으로 옮기면 아직 안 나간 회차가 나간 것으로 잡혀 한 주가 통째로 빠진다.
//     그래서 후보 세 개(δ, δ-7, δ+7) 중 total·delivered 가 그대로인 것을 고른다.
//     판정은 computeSchedule(회차 계산 SSOT)에 직접 물어본다 — 규칙을 여기서 다시 쓰지 않는다.
//
//   총 회차는 어느 경우에도 보존된다(block_weeks + extended_weeks). 바뀌는 것은 남은 회차가
//   나가는 '요일'과, 그만큼 앞뒤로 움직인 종료 예정일뿐이다.

import { computeSchedule, type SubInput } from "./subscription-schedule";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";

// 'mon'..'fri' → 1..5 (Date.getDay 과 같은 기준).
const DAY_NUM: Record<DeliveryDay, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export type DayChangeSlot = {
  deliveryDay: DeliveryDay;
  startedAt: string | null;
  firstShipDate: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  totalWeeks: number; // block_weeks + extended_weeks
};

export type DayChangePlan = {
  ok: true;
  newDay: DeliveryDay;
  /** 새 앵커(started_at). 아직 시작 전(startedAt=null)이면 null — 입금확인 때 부여된다. */
  newStartedAt: string | null;
  /** 바뀐 뒤 다음 배송 예정일. 미정이면 null. */
  nextDate: string | null;
  /** 바뀌기 전 다음 배송 예정일(비교 안내용). */
  prevNextDate: string | null;
  /** 바뀐 뒤 종료 예정일. */
  endDate: string | null;
  /** 남은 회차(변경 전후 동일). */
  remaining: number;
};

export type DayChangeRefusal = { ok: false; reason: string };

export type DayChangeResult = DayChangePlan | DayChangeRefusal;

export function isDeliveryDay(v: string): v is DeliveryDay {
  return (DELIVERY_DAYS as readonly string[]).includes(v);
}

// 변경 계획을 세운다. 실제 쓰기는 서버(RPC)가 하고, 여기서는 값을 산출·검증만 한다.
export function planDeliveryDayChange(
  slot: DayChangeSlot,
  newDay: DeliveryDay,
  todayISO: string
): DayChangeResult {
  if (newDay === slot.deliveryDay) {
    return { ok: false, reason: "이미 그 요일로 받고 계십니다." };
  }
  if (slot.totalWeeks <= 0) {
    return { ok: false, reason: "남은 회차가 없어 요일을 바꿀 수 없습니다." };
  }

  const base: SubInput = {
    startedAt: slot.startedAt,
    totalWeeks: slot.totalWeeks,
    paused: slot.paused,
    pausedAt: slot.pausedAt,
    pausedDays: slot.pausedDays,
    firstShipDate: slot.firstShipDate,
  };
  const now = parseISO(todayISO);
  const before = computeSchedule(base, now);

  // 아직 첫 배송 전(앵커 없음) — 요일만 바꾸면 된다. 앵커는 입금확인 때 새 요일로 부여된다.
  if (!slot.startedAt) {
    return {
      ok: true,
      newDay,
      newStartedAt: null,
      nextDate: null,
      prevNextDate: null,
      endDate: null,
      remaining: before.remaining,
    };
  }
  if (before.done) {
    return { ok: false, reason: "이미 모든 회차가 발송되어 요일을 바꿀 수 없습니다." };
  }

  const delta = DAY_NUM[newDay] - DAY_NUM[slot.deliveryDay];
  const anchor = parseISO(slot.startedAt);

  // 후보: 같은 주 이동(δ) → 한 주 당김(δ-7) → 한 주 미룸(δ+7).
  //   앞의 것부터 시도해 '변경 폭이 가장 작은' 안을 고른다. 셋 다 새 요일에 떨어진다.
  for (const shift of [delta, delta - 7, delta + 7]) {
    const candidate = toISO(addDays(anchor, shift));
    // 앵커를 옮기면 1회차 공휴일 보정(first_ship_date)은 더 이상 그 앵커의 것이 아니다 → 버린다.
    const after = computeSchedule(
      { ...base, startedAt: candidate, firstShipDate: null },
      now
    );
    if (after.total !== before.total) continue;
    if (after.delivered !== before.delivered) continue; // 회차 재발송·소실 방지
    // 다음 배송이 오늘보다 뒤여야 한다(지난 날짜로 잡히면 그 회차가 조용히 사라진다).
    if (after.nextDate != null && after.nextDate <= todayISO) continue;
    return {
      ok: true,
      newDay,
      newStartedAt: candidate,
      nextDate: after.nextDate,
      prevNextDate: before.nextDate,
      endDate: after.endDate,
      remaining: after.remaining,
    };
  }

  return {
    ok: false,
    reason: "지금은 회차가 어긋나 요일을 바꿀 수 없습니다. 이번 주 배송 뒤에 다시 시도해 주세요.",
  };
}
