import { describe, it, expect } from "vitest";
import { normalizeBlocks, type RawBlock } from "./subscription-timeline";

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
