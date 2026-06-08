import { describe, it, expect } from "vitest";
import {
  normalizeBlocks,
  activeBlockForRound,
  activeBlockForDate,
  type RawBlock,
} from "./subscription-timeline";

const chicken = { productName: "닭가슴살", volume: "200g", qty: 2, unitPrice: 10800 };
const beef    = { productName: "소고기",   volume: "150g", qty: 1, unitPrice: 30600 };

// 최종 API: normalizeBlocks(blocks: RawBlock[]). 요일은 각 RawBlock.deliveryDay 에 들어온다.
function raw(over: Partial<RawBlock>): RawBlock {
  return { orderId: "o0", weeks: 4, deliveryDay: "tue", shippingPerWeek: 4000, items: [chicken], ...over };
}

describe("normalizeBlocks", () => {
  it("회차 구간을 누적으로 매긴다", () => {
    const r = normalizeBlocks([
      raw({ orderId: "o0", weeks: 4 }),
      raw({ orderId: "o1", weeks: 8, deliveryDay: "wed", items: [beef] }),
    ]);
    expect(r.map((b) => [b.fromRound, b.toRound])).toEqual([[1, 5], [5, 13]]);
    expect(r[1].deliveryDay).toBe("wed");
  });

  it("items 빈 블록은 직전 블록의 품목·요일·배송비를 상속한다", () => {
    const r = normalizeBlocks([
      raw({ orderId: "o0", weeks: 4, deliveryDay: "tue", items: [chicken] }),
      raw({ orderId: "o1", weeks: 4, deliveryDay: null, items: [] }), // 레거시 연장
    ]);
    expect(r[1].items).toEqual([chicken]);
    expect(r[1].deliveryDay).toBe("tue");
    expect(r[1].orderId).toBe("o0"); // 상속이면 발송 attribution 은 원본(품목 보유) 블록
  });
});

describe("activeBlockForRound", () => {
  const blocks = normalizeBlocks([
    { orderId: "o0", weeks: 4, deliveryDay: "tue", shippingPerWeek: 4000, items: [chicken] },
    { orderId: "o1", weeks: 4, deliveryDay: "wed", shippingPerWeek: 4000, items: [beef] },
  ]);
  it("4회차는 블록0(화·닭)", () => {
    expect(activeBlockForRound(blocks, 4)?.orderId).toBe("o0");
    expect(activeBlockForRound(blocks, 4)?.deliveryDay).toBe("tue");
  });
  it("5회차는 블록1(수·소고기)", () => {
    expect(activeBlockForRound(blocks, 5)?.deliveryDay).toBe("wed");
    expect(activeBlockForRound(blocks, 5)?.items).toEqual([beef]);
  });
  it("범위 밖 회차는 null", () => {
    expect(activeBlockForRound(blocks, 9)).toBeNull();
    expect(activeBlockForRound(blocks, 0)).toBeNull();
  });
});

describe("activeBlockForDate", () => {
  // 시작 2026-01-06(화), 블록0 4회 화, 블록1 4회 수. 정지 없음.
  const input = {
    startedAt: "2026-01-06",
    paused: false, pausedAt: null, pausedDays: 0,
    blocks: [
      { orderId: "o0", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000, items: [chicken] },
      { orderId: "o1", weeks: 4, deliveryDay: "wed" as const, shippingPerWeek: 4000, items: [beef] },
    ],
  };
  it("5회차 날짜(블록1 구간)면 블록1을 돌려준다", () => {
    // 5회차 예정일 = 시작 + 4주 = 2026-02-03 부근 — 그 날짜로 평가
    const b = activeBlockForDate(input, "2026-02-03");
    expect(b?.orderId).toBe("o1");
  });
  it("소진 후(총 8회 지난) 날짜는 null", () => {
    expect(activeBlockForDate(input, "2026-04-01")).toBeNull();
  });
});
