import { describe, it, expect } from "vitest";
import { totalRemainingSeats, type DayCounts } from "./subscriptions";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";

// 요일별 taken만 지정해 DayCounts를 만든다(정원 100 기본). 다른 필드는 합산에 무관.
function makeCounts(
  taken: Partial<Record<DeliveryDay, number>>,
  capacity = 100
): DayCounts {
  return DELIVERY_DAYS.reduce((acc, d) => {
    acc[d] = { active: 0, taken: taken[d] ?? 0, waitlist: 0, capacity };
    return acc;
  }, {} as DayCounts);
}

describe("totalRemainingSeats", () => {
  it("전부 빈 자리 → 500", () => {
    expect(totalRemainingSeats(makeCounts({}))).toBe(500);
  });

  it("부분 점유 → 잔여 합산", () => {
    // 월 30 점유(잔여 70), 화 100 점유(잔여 0), 수·목·금 0(각 100) → 70 + 0 + 300 = 370
    expect(totalRemainingSeats(makeCounts({ mon: 30, tue: 100 }))).toBe(370);
  });

  it("정원 초과 점유는 0으로 클램프", () => {
    // 월 130 점유 → 잔여 0(음수 아님), 나머지 4요일 400 → 400
    expect(totalRemainingSeats(makeCounts({ mon: 130 }))).toBe(400);
  });

  it("전 요일 매진 → 0", () => {
    expect(
      totalRemainingSeats(
        makeCounts({ mon: 100, tue: 100, wed: 100, thu: 100, fri: 100 })
      )
    ).toBe(0);
  });
});
