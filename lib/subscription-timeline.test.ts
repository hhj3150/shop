import { describe, it, expect } from "vitest";
import {
  normalizeBlocks,
  activeBlockForRound,
  activeBlockForDate,
  renewalQuote,
  refundByBlocks,
  totalWeeks,
  type RawBlock,
} from "./subscription-timeline";
import { discountForPeriod } from "./products";

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

describe("renewalQuote", () => {
  // milk-750 정가 12,000 × 3, 8주(period 2 → 12%): 병당 10,560 → 회당 31,680
  const items = [{ listPrice: 12000, qty: 3 }];
  it("8주(period2) 견적", () => {
    const q = renewalQuote(items, 2, 4000);
    expect(q.unitTotalPerDelivery).toBe(31680);   // 10560*3
    expect(q.weeks).toBe(8);
    expect(q.shipping).toBe(32000);                // 4000*8
    expect(q.total).toBe(31680 * 8 + 32000);       // 285,440
    expect(q.belowMin).toBe(false);
  });
  it("회당 25,000 미만이면 belowMin true", () => {
    expect(renewalQuote([{ listPrice: 12000, qty: 1 }], 1, 4000).belowMin).toBe(true);
  });
  it("허용 안 된 기간은 throw", () => {
    expect(() => renewalQuote(items, 5 as never, 4000)).toThrow();
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

describe("refundByBlocks", () => {
  // 시작 2026-01-06(화), 블록0 4회(회당상품 21600+배송4000), 블록1 4회(회당상품 30600+배송4000)
  const input = {
    startedAt: "2026-01-06", paused: false, pausedAt: null, pausedDays: 0,
    blocks: [
      { orderId: "o0", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000,
        items: [{ productName: "닭", volume: "200g", qty: 2, unitPrice: 10800 }] },
      { orderId: "o1", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000,
        items: [{ productName: "소", volume: "150g", qty: 1, unitPrice: 30600 }] },
    ],
  };
  it("2회 배송 시점 환불 = 남은 회차의 소속 블록 단가 합", () => {
    // 2회 배송 완료(블록0 2회 남음 @ 21600+4000=25600, 블록1 4회 @ 30600+4000=34600)
    // 남은 = 25600*2 + 34600*4 = 51,200 + 138,400 = 189,600
    expect(refundByBlocks(input, "2026-01-13")).toBe(189600);
  });
  it("단일 블록·extended0이면 기존 평균식과 동일", () => {
    const single = { ...input, blocks: [input.blocks[0]] };
    // 1회 배송 후 남은 3회 @ 25600 = 76,800
    expect(refundByBlocks(single, "2026-01-06")).toBe(76800);
  });
});

describe("totalWeeks invariant", () => {
  it("totalWeeks = 원주문 weeks + 연장 weeks 합", () => {
    const blocks: RawBlock[] = [
      { orderId: "o0", weeks: 4, deliveryDay: "tue", shippingPerWeek: 4000, items: [chicken] },
      { orderId: "o1", weeks: 8, deliveryDay: "wed", shippingPerWeek: 4000, items: [beef] },
      { orderId: "o2", weeks: 4, deliveryDay: null, shippingPerWeek: 4000, items: [] },
    ];
    expect(totalWeeks(blocks)).toBe(16); // 4 + 8 + 4
  });
  it("빈 배열은 0", () => {
    expect(totalWeeks([])).toBe(0);
  });
});
