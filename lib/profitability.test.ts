import { describe, expect, it } from "vitest";
import { profitLine, profitTotals } from "./profitability";

describe("profitLine", () => {
  it("매출(온라인@판매가 + B2B매출) − 원가×수량 = 이익, 이익률 계산", () => {
    // 온라인 10개 @3500 = 35000, B2B 20개 매출 50000 → 매출 85000
    // 원가 1500 × (10+20)=30 → COGS 45000, 이익 40000, 이익률 47.06%
    const l = profitLine({
      productKey: "헤이 180",
      onlineQty: 10,
      b2bQty: 20,
      b2bRevenue: 50000,
      cost: 1500,
      price: 3500,
    });
    expect(l.qty).toBe(30);
    expect(l.revenue).toBe(85000);
    expect(l.cogs).toBe(45000);
    expect(l.profit).toBe(40000);
    expect(l.marginPct).toBe(47.1); // 40000/85000 = 47.058 → 47.1
  });

  it("매출 0이면 이익률 0 (음수 이익이어도 0으로 표기)", () => {
    const l = profitLine({ productKey: "x", onlineQty: 0, b2bQty: 0, b2bRevenue: 0, cost: 1000, price: 0 });
    expect(l.revenue).toBe(0);
    expect(l.marginPct).toBe(0);
  });

  it("음수 입력은 0으로 클램프", () => {
    const l = profitLine({ productKey: "x", onlineQty: -5, b2bQty: 3, b2bRevenue: -10, cost: -1, price: 100 });
    expect(l.qty).toBe(3);
    expect(l.revenue).toBe(0);
    expect(l.cogs).toBe(0);
  });
});

describe("profitTotals", () => {
  it("전체 합계와 종합 이익률", () => {
    const lines = [
      profitLine({ productKey: "a", onlineQty: 10, b2bQty: 0, b2bRevenue: 0, cost: 500, price: 1000 }),
      profitLine({ productKey: "b", onlineQty: 0, b2bQty: 10, b2bRevenue: 20000, cost: 800, price: 0 }),
    ];
    // a: 매출 10000, cogs 5000 / b: 매출 20000, cogs 8000
    const t = profitTotals(lines);
    expect(t.revenue).toBe(30000);
    expect(t.cogs).toBe(13000);
    expect(t.profit).toBe(17000);
    expect(t.marginPct).toBe(56.7); // 17000/30000 = 56.66 → 56.7
  });
});
