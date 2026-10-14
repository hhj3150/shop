// 구독 생애주기 회차 점검 — 일시정지→재개 · 건너뛰기 · 요일 변경 · 배송일 변경이 섞여도
//   결제한 회차가 '정확히 total 회' 나가고, 회차 번호가 1..total 로 이어지는지 날짜를 하루씩
//   굴려서 본다. 관리자 배송 시트·기간별 명단이 쓰는 로스터(buildRosterForDate)가 그날
//   손님을 내보내면 '출고'로 기록하고, 서버 RPC(resume_subscription / auto_resume_skips /
//   change_delivery_day / admin_reschedule_shipment)의 규칙은 운영 DB 정의(2026-10-13
//   pg_get_functiondef)를 그대로 옮겨 적용한다.
//
//   두 경로를 모두 돌린다.
//     · 달력 경로: shippedBySlot 미지정 — 2026-10-13 현재 운영 활성 슬롯 95건 전부가 이 경로다
//       (회차 기준점 확정 0건).
//     · 기록 경로: 관리자 회차 확정 후 — 출고 기록 수가 진행도의 진실.
import { describe, it, expect } from "vitest";
import { buildRosterForDate } from "./delivery-roster";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";
import { planDeliveryDayChange } from "./delivery-day-change";
import { ceilToWeeks } from "./subscription-schedule";
import { roundShipPlan } from "./ship-date";
import { checkRescheduleTarget, type ShipmentReschedule } from "./shipment-reschedule";
import type { DeliveryDay } from "./cart";
import type { RosterItemFields, RosterOrderFields } from "./delivery-roster";

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}
function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

// SQL public.sub_delivery_dates(p_anchor, null, p_total, p_pdays) 의 TS 복제(운영 정의 기준).
function subDeliveryDates(anchor: string, total: number, pdays: number): string[] {
  const out: string[] = [];
  let defer = 0;
  const pd = ceilToWeeks(pdays);
  for (let k = 1; k <= total; k++) {
    const base = addDays(anchor, (k - 1) * 7 + pd + defer);
    const plan = roundShipPlan(base, k === 1);
    defer += plan.deferDays;
    out.push(plan.ship);
  }
  return out;
}
// SQL public.missed_delivery_weeks — [from, to) 에 놓인 배송 예정일 수.
function missedDeliveryWeeks(anchor: string, total: number, pdays: number, from: string, to: string): number {
  const span = Math.ceil(Math.max(0, daysBetween(from, to)) / 7);
  return subDeliveryDates(anchor, total + span + 2, pdays).filter((d) => d >= from && d < to).length;
}

// ── 시뮬레이터 ────────────────────────────────────────────────────────────
type Action =
  | { on: string; kind: "pause" }
  | { on: string; kind: "resume" }
  | { on: string; kind: "skip"; skipDate: string } // 손님 '이번 주 건너뛰기'
  | { on: string; kind: "changeDay"; newDay: DeliveryDay }
  | { on: string; kind: "reschedule"; from: string; to: string };

type Shipment = { date: string; round: number; scheduledISO: string };

type SimResult = {
  shipments: Shipment[];
  refused: string[]; // 거절된 조작(사유)
  slot: DispatchSlotInfo & { delivery_day: DeliveryDay; skip_resume_on: string | null };
};

function simulate(opts: {
  startedAt: string;
  day: DeliveryDay;
  total: number;
  until: string;
  actions: Action[];
  recordBased?: boolean; // 기록 경로(회차 확정 후)
  bypassGuards?: boolean; // 서버 가드 없던 옛 동작 재현(회귀 기록용)
}): SimResult {
  const order: RosterOrderFields = {
    id: "o1",
    order_type: "구독",
    block_weeks: opts.total,
    ship_date: null,
    ship_name: "홍길동",
  };
  const item: RosterItemFields = {
    order_id: "o1",
    product_name: "우유",
    volume: "180ml",
    delivery_day: opts.day,
    qty: 1,
  };
  const slot = {
    status: "활성",
    started_at: opts.startedAt as string | null,
    first_ship_date: null as string | null,
    paused: false,
    paused_at: null as string | null,
    paused_days: 0,
    extended_weeks: 0,
    delivery_day: opts.day,
    skip_resume_on: null as string | null,
  };
  const reschedules: ShipmentReschedule[] = [];
  const shipments: Shipment[] = [];
  const refused: string[] = [];
  const shippedDates = new Set<string>();

  // guard_pause_reschedules — 진행 중 변경(예정일 지남·새 날짜 미래·미출고)이 있으면 정지 거절,
  //   미래 예정일 변경은 지운다(정지가 우선).
  const guardPause = (today: string): string | null => {
    if (opts.bypassGuards) return null;
    const inflight = reschedules.find(
      (x) => x.from_date < today && x.to_date >= today && !shippedDates.has(x.to_date)
    );
    if (inflight) return `${inflight.to_date}에 보내기로 옮겨 둔 배송이 있습니다`;
    for (let i = reschedules.length - 1; i >= 0; i--) {
      if (reschedules[i].from_date >= today) reschedules.splice(i, 1);
    }
    return null;
  };

  const doResume = (today: string) => {
    // resume_subscription / auto_resume_skips: [정지일, 재개일) 의 놓친 회차 × 7
    const missed = missedDeliveryWeeks(slot.started_at!, opts.total, slot.paused_days, slot.paused_at!, today);
    slot.paused = false;
    slot.paused_days += missed * 7;
    slot.paused_at = null;
    slot.skip_resume_on = null;
  };

  for (let d = opts.startedAt; d <= opts.until; d = addDays(d, 1)) {
    // 00:15 cron — 건너뛰기 자동 재개
    if (slot.paused && slot.skip_resume_on && slot.skip_resume_on <= d) doResume(d);

    for (const a of opts.actions.filter((x) => x.on === d)) {
      if (a.kind === "pause") {
        const g = slot.paused ? "이미 정지" : guardPause(d);
        if (g) refused.push(`${d} pause: ${g}`);
        else {
          slot.paused = true;
          slot.paused_at = d;
          slot.skip_resume_on = null;
        }
      } else if (a.kind === "resume") {
        if (!slot.paused) refused.push(`${d} resume: 정지 아님`);
        else doResume(d);
      } else if (a.kind === "skip") {
        const g = slot.paused || a.skipDate <= d ? "불가" : guardPause(d);
        if (g) refused.push(`${d} skip: ${g}`);
        else {
          slot.paused = true;
          slot.paused_at = d;
          slot.skip_resume_on = addDays(a.skipDate, 1);
        }
      } else if (a.kind === "changeDay") {
        const plan = planDeliveryDayChange(
          {
            deliveryDay: slot.delivery_day,
            startedAt: slot.started_at,
            firstShipDate: null,
            paused: slot.paused,
            pausedAt: slot.paused_at,
            pausedDays: slot.paused_days,
            totalWeeks: opts.total,
          },
          a.newDay,
          d
        );
        if (!plan.ok) {
          refused.push(`${d} changeDay: ${plan.reason}`);
          continue;
        }
        // change_delivery_day 서버 검사: 진행 중 배송일 변경이 있으면 거절
        if (reschedules.some((x) => x.to_date >= d && !shippedDates.has(x.to_date))) {
          refused.push(`${d} changeDay(server): 옮겨 둔 배송이 있어 요일을 바꿀 수 없습니다`);
          continue;
        }
        // change_delivery_day 서버 검사: 기발송 수(sub_delivery_dates <= today) 불변
        const before = subDeliveryDates(slot.started_at!, opts.total, slot.paused_days).filter((x) => x <= d).length;
        const after = subDeliveryDates(plan.newStartedAt!, opts.total, slot.paused_days).filter((x) => x <= d).length;
        if (before !== after) {
          refused.push(`${d} changeDay(server): 회차 어긋남 ${before}→${after}`);
          continue;
        }
        slot.delivery_day = a.newDay;
        slot.started_at = plan.newStartedAt;
        item.delivery_day = a.newDay;
      } else if (a.kind === "reschedule") {
        const chk = checkRescheduleTarget(a.from, a.to);
        if (!chk.ok) {
          refused.push(`${d} reschedule: ${chk.reason}`);
          continue;
        }
        if (shippedDates.has(a.from)) {
          refused.push(`${d} reschedule: 이미 출고된 회차`);
          continue;
        }
        if (slot.paused) {
          refused.push(`${d} reschedule: 정지(건너뛰기) 중인 구독은 배송일을 옮길 수 없습니다`);
          continue;
        }
        reschedules.push({ order_id: "o1", delivery_day: slot.delivery_day, from_date: a.from, to_date: a.to });
      }
    }

    const slotInfo: DispatchSlotInfo = {
      status: slot.status,
      started_at: slot.started_at,
      first_ship_date: null,
      paused: slot.paused,
      paused_at: slot.paused_at,
      paused_days: slot.paused_days,
      extended_weeks: 0,
    };
    // 기록 경로: '그 날짜 전까지' 나간 수(당일 출고 제외) — 관리자 화면(shippedRoundsBeforeBySlot)과 같은 규칙.
    const shippedBefore = (beforeISO: string) => [...shippedDates].filter((x) => x < beforeISO).length;
    const entries = buildRosterForDate({
      dateISO: d,
      items: [item],
      orderById: new Map([["o1", order]]),
      slotByOrder: new Map([["o1", slotInfo]]),
      confirmedOrderIds: new Set(["o1"]),
      pausedOrderIds: new Set(slot.paused ? ["o1"] : []),
      slotIdByOrder: new Map([["o1", 1]]),
      slotById: new Map([[1, slotInfo]]),
      shippedBefore: opts.recordBased ? (_slotId: number, beforeISO: string) => shippedBefore(beforeISO) : undefined,
      reschedules,
    });
    for (const e of entries) {
      const beforeISO = e.scheduledISO < d ? e.scheduledISO : d;
      const round = dispatchScheduleForSlot(
        slotInfo,
        opts.total,
        e.scheduledISO,
        opts.recordBased ? shippedBefore(beforeISO) : null
      ).round;
      shipments.push({ date: d, round, scheduledISO: e.scheduledISO });
      shippedDates.add(d); // shipment_log 키 = 주문|발송일 (한 날짜 = 한 회차)
    }
  }
  return { shipments, refused, slot };
}

const dates = (r: SimResult) => r.shipments.map((s) => s.date);
const rounds = (r: SimResult) => r.shipments.map((s) => s.round);

// 두 경로를 같은 시나리오로 돌려 결과를 비교한다.
function both(opts: Parameters<typeof simulate>[0]) {
  return {
    calendar: simulate({ ...opts, recordBased: false }),
    record: simulate({ ...opts, recordBased: true }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 기준 구독: 2026-06-01(월) 시작, 4주. 예정: 06-01, 06-08, 06-15, 06-22.
const BASE = { startedAt: "2026-06-01", day: "mon" as DeliveryDay, total: 4, until: "2026-08-31" };

describe("회차 점검 — 아무 조작 없음", () => {
  it("4회가 예정대로 나가고 회차는 1..4", () => {
    const { calendar, record } = both({ ...BASE, actions: [] });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });
});

describe("회차 점검 — 일시정지 → 재개", () => {
  it("2회차 뒤 수요일에 정지, 2주 뒤 재개: 놓친 2회가 뒤로 밀려 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "pause" },
        { on: "2026-06-24", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-29", "2026-07-06"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.slot.paused_days).toBe(14);
    }
  });

  it("배송일이 끼지 않은 짧은 정지(화→금)는 회차를 밀지 않는다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-09", kind: "pause" },
        { on: "2026-06-12", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
      expect(r.slot.paused_days).toBe(0);
    }
  });

  it("배송 요일 당일에 정지하면 그날 배송은 나가지 않고 재개 뒤로 밀린다", () => {
    // 월요일 아침 정지 → 그날 명단에서 빠진다(정지 중). 재개 시 [정지일, 재개일) 에 그 월요일 포함 → 1주 적립.
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-08", kind: "pause" },
        { on: "2026-06-11", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-15", "2026-06-22", "2026-06-29"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("재개 당일이 배송 요일이면 그날 바로 나간다(재개일은 정지 구간에서 제외)", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "pause" },
        { on: "2026-06-22", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      // 놓친 회차: 06-15 한 번 → 1주 밀림. 06-22 재개 당일 발송.
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-22", "2026-06-29"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("휴배송 주(2026 추석 9/24~9/28)를 낀 정지: 휴무 주는 정지로 세지 않고 총 회차 보존", () => {
    // 9/7(월) 시작 4주: 09-07, 09-14, 09-21, 09-28(추석 대체휴일) → 그 주는 9/29(화) 발송.
    const { calendar, record } = both({
      startedAt: "2026-09-07",
      day: "mon",
      total: 4,
      until: "2026-11-30",
      actions: [
        { on: "2026-09-16", kind: "pause" },
        { on: "2026-10-07", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments).toHaveLength(4);
      expect(dates(r).slice(0, 2)).toEqual(["2026-09-07", "2026-09-14"]);
      // 정지 구간 [09-16, 10-07) 에 놓인 예정일: 09-21, 09-29(추석 주 월요일분) → 2회 → 14일 적립.
      expect(r.slot.paused_days).toBe(14);
    }
    expect(dates(calendar)).toEqual(dates(record));
  });

  it("남은 회차보다 긴 정지(3회 남기고 6주 정지)에도 남은 회차가 삼켜지지 않는다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-03", kind: "pause" },
        { on: "2026-07-15", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(dates(r)).toEqual(["2026-06-01", "2026-07-20", "2026-07-27", "2026-08-03"]);
    }
  });

  it("정지·재개를 두 번 반복해도 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-03", kind: "pause" },
        { on: "2026-06-10", kind: "resume" },
        { on: "2026-06-17", kind: "pause" },
        { on: "2026-06-30", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments).toHaveLength(4);
    }
    expect(dates(calendar)).toEqual(dates(record));
  });
});

describe("회차 점검 — 이번 주 건너뛰기(skip)", () => {
  it("다음 배송(06-15)을 건너뛰면 자동 재개 뒤 06-22·06-29 로 밀려 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-10", kind: "skip", skipDate: "2026-06-15" }],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-22", "2026-06-29"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.slot.paused).toBe(false);
      expect(r.slot.paused_days).toBe(7);
    }
  });

  it("건너뛰기 뒤 요일 변경·일시정지를 이어 해도 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "skip", skipDate: "2026-06-15" },
        { on: "2026-06-18", kind: "changeDay", newDay: "wed" },
        { on: "2026-06-25", kind: "pause" },
        { on: "2026-07-07", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments).toHaveLength(4);
    }
    expect(dates(calendar)).toEqual(dates(record));
  });
});

describe("회차 점검 — 배송 요일 변경", () => {
  it("월→수 (2회차 뒤 화요일에 변경): 남은 2회가 수요일로 나가고 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-09", kind: "changeDay", newDay: "wed" }],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-10", "2026-06-17"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  // ★ 2026-10-13 점검에서 발견. 수요일 당일에 월→수로 바꾸면 그날 명단에 바로 올라 같은 주에
  //   두 번 나가고(월요일분 + 수요일분), 달력은 수요일 자리를 '이미 나간 회차'로 세어 1회를 더 센다.
  it("월→수를 '수요일 당일'에 하면 거절한다 — 허용하면 같은 주 2회 발송·달력 1회 초과", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-10", kind: "changeDay", newDay: "wed" }],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toHaveLength(1);
      expect(r.refused[0]).toContain("오늘이 새 요일의 배송일");
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22"]);
    }
  });

  it("월→금 변경을 '이번 주 월요일 배송 전'(일요일)에 하면 이번 주 금요일로 옮겨 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-07", kind: "changeDay", newDay: "fri" }],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-12", "2026-06-19", "2026-06-26"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("수→월 변경(앞 요일로)도 회차 재발송·소실 없이 총 4회", () => {
    const { calendar, record } = both({
      startedAt: "2026-06-03",
      day: "wed",
      total: 4,
      until: "2026-08-31",
      actions: [{ on: "2026-06-11", kind: "changeDay", newDay: "mon" }],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(dates(r)).toEqual(["2026-06-03", "2026-06-10", "2026-06-15", "2026-06-22"]);
    }
  });

  it("요일 변경을 두 번 해도 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-09", kind: "changeDay", newDay: "thu" },
        { on: "2026-06-15", kind: "changeDay", newDay: "tue" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments).toHaveLength(4);
    }
    expect(dates(calendar)).toEqual(dates(record));
  });

  it("정지 중에 요일을 바꾸고 재개해도 총 4회", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "pause" },
        { on: "2026-06-16", kind: "changeDay", newDay: "thu" },
        { on: "2026-06-23", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments).toHaveLength(4);
    }
    expect(dates(calendar)).toEqual(dates(record));
  });
});

describe("회차 점검 — 배송일 변경(회차 1회 이동)", () => {
  it("3회차(06-15 월)를 06-17(수)로: 그 회차만 수요일, 4회차는 제 요일(06-22)", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-10", kind: "reschedule", from: "2026-06-15", to: "2026-06-17" }],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-17", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(r.shipments[2].scheduledISO).toBe("2026-06-15");
    }
  });

  it("앞당김(06-15 월 → 06-12 금)도 회차 번호가 유지된다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-09", kind: "reschedule", from: "2026-06-15", to: "2026-06-12" }],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-12", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("마지막 회차(06-22)를 06-25(목)로 미뤄도 그 뒤 월요일(06-29)에 또 나가지 않는다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [{ on: "2026-06-17", kind: "reschedule", from: "2026-06-22", to: "2026-06-25" }],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-25"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("두 회차를 각각 옮겨도 총 4회·회차 순서 유지", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-03", kind: "reschedule", from: "2026-06-08", to: "2026-06-10" },
        { on: "2026-06-11", kind: "reschedule", from: "2026-06-15", to: "2026-06-19" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-10", "2026-06-19", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("배송일 변경 뒤 일시정지·재개가 이어져도 총 4회", () => {
    // 3회차 06-15 → 06-17 로 옮긴 뒤, 06-18 정지 → 06-30 재개(놓친 회차: 06-22 → 1주).
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "reschedule", from: "2026-06-15", to: "2026-06-17" },
        { on: "2026-06-18", kind: "pause" },
        { on: "2026-06-30", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-17", "2026-07-06"]);
    }
  });

  it("공휴일·휴무 주: 10-05(월, 대체휴일) 회차는 10-06(화)에 나가고, 그걸 10-08(목)로 옮겨도 총 4회", () => {
    const { calendar, record } = both({
      startedAt: "2026-09-14",
      day: "mon",
      total: 4,
      until: "2026-11-30",
      actions: [{ on: "2026-10-01", kind: "reschedule", from: "2026-10-06", to: "2026-10-08" }],
    });
    for (const r of [calendar, record]) {
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
      // 09-14 · (09-21 주 목장 휴무 → 09-28 대체휴일 → 09-29 화) · (10-05 대체휴일 → 10-06 화 → 변경 10-08 목) · 10-12
      expect(dates(r)).toEqual(["2026-09-14", "2026-09-29", "2026-10-08", "2026-10-12"]);
    }
  });
});

describe("회차 점검 — 겹치는 조작(서버 가드가 막는다)", () => {
  // ★ 2026-10-13 점검에서 발견: 옮겨 둔 회차가 나가기 전에 정지하면 달력 경로에서 그 회차가 사라졌다.
  //   06-08 회차를 06-10 으로 옮긴 뒤 06-09 정지: 06-08 은 이미 지난 예정일이라 놓친 회차로 안 세고,
  //   06-10 은 정지 중이라 안 나간다 → 3회만 발송. 가드가 그 정지를 거절한다.
  it("옮겨 둔 회차가 나가기 전의 정지는 거절된다 — 허용하면 달력 경로에서 1회 소실", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-03", kind: "reschedule", from: "2026-06-08", to: "2026-06-10" },
        { on: "2026-06-09", kind: "pause" },
        { on: "2026-06-16", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused.filter((x) => x.includes("pause"))).toHaveLength(1);
      expect(r.refused.find((x) => x.includes("pause"))).toContain("옮겨 둔 배송이 있습니다");
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-10", "2026-06-15", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("가드 없이 그 정지를 허용했다면 달력 경로는 3회에서 끝난다(회귀 기록)", () => {
    // 가드가 왜 필요한지 남긴다 — 시뮬레이터의 가드를 우회해 옛 동작을 재현한다.
    const r = simulate({
      ...BASE,
      recordBased: false,
      actions: [
        { on: "2026-06-03", kind: "reschedule", from: "2026-06-08", to: "2026-06-10" },
        { on: "2026-06-09", kind: "pause" },
        { on: "2026-06-16", kind: "resume" },
      ],
      bypassGuards: true,
    });
    expect(r.shipments).toHaveLength(3);
  });

  it("아직 오지 않은 예정일의 변경은 정지가 대신한다(기록 삭제) — 총 4회 유지", () => {
    // 06-15 회차를 06-17 로 옮겨 둔 상태에서 06-10 정지 → 06-23 재개. 변경 기록은 지워지고
    //   정지 구간 [06-10, 06-23) 의 예정일 06-15·06-22 가 놓친 회차로 적립된다.
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-03", kind: "reschedule", from: "2026-06-15", to: "2026-06-17" },
        { on: "2026-06-10", kind: "pause" },
        { on: "2026-06-23", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused).toEqual([]);
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-29", "2026-07-06"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("정지 중인 구독의 회차는 옮길 수 없다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "pause" },
        { on: "2026-06-11", kind: "reschedule", from: "2026-06-22", to: "2026-06-24" },
        { on: "2026-06-16", kind: "resume" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused.find((x) => x.includes("reschedule"))).toContain("정지(건너뛰기) 중");
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });

  it("옮겨 둔 회차가 있으면 요일 변경을 거절한다", () => {
    const { calendar, record } = both({
      ...BASE,
      actions: [
        { on: "2026-06-10", kind: "reschedule", from: "2026-06-15", to: "2026-06-17" },
        { on: "2026-06-12", kind: "changeDay", newDay: "thu" },
      ],
    });
    for (const r of [calendar, record]) {
      expect(r.refused.find((x) => x.includes("changeDay"))).toContain("옮겨 둔 배송");
      expect(dates(r)).toEqual(["2026-06-01", "2026-06-08", "2026-06-17", "2026-06-22"]);
      expect(rounds(r)).toEqual([1, 2, 3, 4]);
    }
  });
});
