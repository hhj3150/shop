import { describe, it, expect } from "vitest";
import { planDeliveryDayChange, type DayChangeSlot } from "@/lib/delivery-day-change";
import { computeSchedule } from "@/lib/subscription-schedule";
import { DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";

const DAY_NUM: Record<DeliveryDay, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

function parseISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// 2026-10-05 는 월요일. 요일별 앵커(같은 주).
const ANCHOR: Record<DeliveryDay, string> = {
  mon: "2026-10-05",
  tue: "2026-10-06",
  wed: "2026-10-07",
  thu: "2026-10-08",
  fri: "2026-10-09",
};

function slotOf(day: DeliveryDay, over: Partial<DayChangeSlot> = {}): DayChangeSlot {
  return {
    deliveryDay: day,
    startedAt: ANCHOR[day],
    firstShipDate: null,
    paused: false,
    pausedAt: null,
    pausedDays: 0,
    totalWeeks: 12,
    ...over,
  };
}

describe("planDeliveryDayChange — 회차 보존 불변식", () => {
  // 전 요일 조합 × 여러 시점에서, 총 회차와 '이미 나간 회차'가 변하지 않아야 한다.
  //   하나라도 어긋나면 손님이 한 주를 더 받거나(이중 발송) 한 주를 잃는다.
  const TODAYS = [
    "2026-10-12", // 2주차 월
    "2026-10-14", // 2주차 수
    "2026-10-16", // 2주차 금
    "2026-11-02", // 5주차 월
    "2026-11-06", // 5주차 금
    "2026-12-14", // 종료 직전
  ];

  for (const from of DELIVERY_DAYS) {
    for (const to of DELIVERY_DAYS) {
      if (from === to) continue;
      for (const today of TODAYS) {
        it(`${from}→${to} (${today}): 총 회차·기발송 회차 보존`, () => {
          const slot = slotOf(from);
          const r = planDeliveryDayChange(slot, to, today);
          if (!r.ok) return; // 거절은 안전한 결과 — 잘못된 값을 쓰지 않는다
          expect(r.newStartedAt).not.toBeNull();

          const before = computeSchedule(
            { startedAt: slot.startedAt, totalWeeks: 12, paused: false, pausedAt: null, pausedDays: 0 },
            parseISO(today)
          );
          const after = computeSchedule(
            { startedAt: r.newStartedAt, totalWeeks: 12, paused: false, pausedAt: null, pausedDays: 0 },
            parseISO(today)
          );
          expect(after.total).toBe(before.total);
          expect(after.delivered).toBe(before.delivered);
          expect(after.remaining).toBe(before.remaining);
          // 새 앵커는 반드시 새 요일에 떨어져야 한다(로스터가 그 요일로 발송하므로).
          expect(parseISO(r.newStartedAt!).getDay()).toBe(DAY_NUM[to]);
          // 다음 배송은 오늘보다 뒤.
          if (after.nextDate) expect(after.nextDate > today).toBe(true);
        });
      }
    }
  }
});

describe("planDeliveryDayChange — 개별 사례", () => {
  it("월→금: 이미 받은 월요일 회차가 다시 나가지 않는다", () => {
    // 앵커 11/02(월), 오늘 11/03(화) — 1회차(11/02)는 이미 받았다. (공휴일 없는 주)
    const slot = slotOf("mon", { startedAt: "2026-11-02" });
    const r = planDeliveryDayChange(slot, "fri", "2026-11-03");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = computeSchedule(
      { startedAt: r.newStartedAt, totalWeeks: 12, paused: false, pausedAt: null, pausedDays: 0 },
      parseISO("2026-11-03")
    );
    expect(after.delivered).toBe(1); // 1회차는 그대로 '나간 것'
    expect(r.nextDate).toBe("2026-11-06"); // 다음은 이번 주 금요일
  });

  it("금→월: 이번 주 금요일을 받기 전이면 한 주가 사라지지 않는다", () => {
    // 앵커 11/06(금), 오늘 11/04(수) — 1회차(11/06)는 아직.
    const r = planDeliveryDayChange(slotOf("fri", { startedAt: "2026-11-06" }), "mon", "2026-11-04");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = computeSchedule(
      { startedAt: r.newStartedAt, totalWeeks: 12, paused: false, pausedAt: null, pausedDays: 0 },
      parseISO("2026-11-04")
    );
    expect(after.delivered).toBe(0);
    expect(after.remaining).toBe(12);
    expect(r.nextDate! > "2026-11-04").toBe(true);
  });

  it("아직 시작 전(앵커 없음)이면 요일만 바꾼다", () => {
    const r = planDeliveryDayChange(slotOf("mon", { startedAt: null }), "thu", "2026-10-06");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newStartedAt).toBeNull();
  });

  it("같은 요일로는 바꾸지 않는다", () => {
    const r = planDeliveryDayChange(slotOf("wed"), "wed", "2026-10-06");
    expect(r.ok).toBe(false);
  });

  it("회차를 다 쓴 구독은 거절한다", () => {
    const r = planDeliveryDayChange(slotOf("mon"), "wed", "2027-06-01");
    expect(r.ok).toBe(false);
  });

  it("일시정지 중에도 회차 보존이 깨지지 않는다", () => {
    const slot = slotOf("tue", { paused: true, pausedAt: "2026-10-20", pausedDays: 3 });
    const r = planDeliveryDayChange(slot, "thu", "2026-10-26");
    if (!r.ok) return;
    const before = computeSchedule(
      { startedAt: slot.startedAt, totalWeeks: 12, paused: true, pausedAt: "2026-10-20", pausedDays: 3 },
      parseISO("2026-10-26")
    );
    const after = computeSchedule(
      { startedAt: r.newStartedAt, totalWeeks: 12, paused: true, pausedAt: "2026-10-20", pausedDays: 3 },
      parseISO("2026-10-26")
    );
    expect(after.total).toBe(before.total);
    expect(after.delivered).toBe(before.delivered);
  });
});
