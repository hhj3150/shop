import { describe, expect, it } from "vitest";
import { settleClient, aggregateDemandByClient } from "./b2b-settlement";
import type { B2bDemand } from "./clients";

const KEYS = ["헤이 180", "헤이 750", "요거트 180"] as const;

describe("settleClient", () => {
  it("수량×단가로 라인·소계·합계를 낸다", () => {
    const qty = { "헤이 180": 10, "헤이 750": 4, "요거트 180": 0 };
    const price = { "헤이 180": 2500, "헤이 750": 6000, "요거트 180": 3000 };
    const r = settleClient(KEYS, qty, price);
    // 수량 0인 요거트는 제외.
    expect(r.lines).toEqual([
      { productKey: "헤이 180", qty: 10, unitPrice: 2500, amount: 25000 },
      { productKey: "헤이 750", qty: 4, unitPrice: 6000, amount: 24000 },
    ]);
    expect(r.qtyTotal).toBe(14);
    expect(r.amountTotal).toBe(49000);
  });

  it("단가 미설정(0)은 금액 0으로 계산", () => {
    const r = settleClient(KEYS, { "헤이 180": 5 }, {});
    expect(r.amountTotal).toBe(0);
    expect(r.lines[0]).toEqual({ productKey: "헤이 180", qty: 5, unitPrice: 0, amount: 0 });
  });

  it("음수 단가는 0으로 클램프", () => {
    const r = settleClient(KEYS, { "헤이 180": 2 }, { "헤이 180": -100 });
    expect(r.lines[0].amount).toBe(0);
  });
});

describe("aggregateDemandByClient", () => {
  const rows: B2bDemand[] = [
    { demand_date: "2026-07-01", client_id: "A", product_key: "헤이 180", qty: 5 },
    { demand_date: "2026-07-02", client_id: "A", product_key: "헤이 180", qty: 3 },
    { demand_date: "2026-07-01", client_id: "A", product_key: "헤이 750", qty: 2 },
    { demand_date: "2026-07-01", client_id: "B", product_key: "헤이 180", qty: 9 },
  ];

  it("활성 거래처만 골라 기간 수량을 합산", () => {
    const agg = aggregateDemandByClient(rows, new Set(["A"]));
    expect(agg).toEqual({ A: { "헤이 180": 8, "헤이 750": 2 } });
  });

  it("비활성 거래처는 제외", () => {
    const agg = aggregateDemandByClient(rows, new Set(["B"]));
    expect(agg).toEqual({ B: { "헤이 180": 9 } });
  });
});
