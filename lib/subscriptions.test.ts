import { describe, it, expect } from "vitest";
import {
  totalRemainingSeats,
  toMySubscriptions,
  refundAmount,
  type DayCounts,
} from "./subscriptions";
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

// 환불 미리보기가 서버(cancel_subscription)와 동일 결과를 내려면
// totalAmount = 원주문 + Σ(입금확인 연장주문), totalWeeks = block + extended 여야 한다.
describe("toMySubscriptions — 연장분 합산", () => {
  const slotRow = {
    id: 7,
    delivery_day: "mon" as DeliveryDay,
    status: "활성",
    started_at: "2026-06-01",
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 4, // 연장 입금확인 4회 누적
    orders: {
      block_weeks: 4,
      period_months: 1,
      order_no: "20260601-0001",
      total_amount: 40000, // 원주문 4만원
    },
  };

  it("총회차=원+연장, 총납입액=원+입금확인 연장주문", () => {
    const subs = toMySubscriptions(
      [slotRow],
      [{ renews_slot_id: 7, total_amount: 40000 }] // 연장주문 4만원
    );
    expect(subs[0].totalWeeks).toBe(8);
    expect(subs[0].totalAmount).toBe(80000);
  });

  it("환불 미리보기 = 서버와 동일: 8회/8만, 남은 6회 → 60,000원", () => {
    const subs = toMySubscriptions(
      [slotRow],
      [{ renews_slot_id: 7, total_amount: 40000 }]
    );
    expect(refundAmount(subs[0], 6)).toBe(60000);
  });

  it("다른 슬롯의 연장주문은 섞이지 않는다", () => {
    const subs = toMySubscriptions(
      [slotRow],
      [{ renews_slot_id: 99, total_amount: 40000 }] // 다른 슬롯
    );
    expect(subs[0].totalAmount).toBe(40000); // 연장 합산 없음
  });
});
