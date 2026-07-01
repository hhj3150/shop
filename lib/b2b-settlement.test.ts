import { describe, expect, it } from "vitest";
import { settleClient, aggregateDemandByClient } from "./b2b-settlement";
import type { B2bDemand } from "./clients";

const KEYS = ["헤이 180", "헤이 750", "요거트 180"] as const;
// 헤이(우유)=면세, 요거트=과세.
const TAX_FREE = { "헤이 180": true, "헤이 750": true, "요거트 180": false };

describe("settleClient", () => {
  it("공급가액·세액(과세 10%)·합계를 낸다 — 면세품은 세액 0", () => {
    const qty = { "헤이 180": 10, "요거트 180": 4 };
    const price = { "헤이 180": 2500, "요거트 180": 3000 };
    const r = settleClient(KEYS, qty, price, TAX_FREE);
    // 헤이 180: 공급 25000, 면세 → 세액 0
    // 요거트 180: 공급 12000, 과세 → 세액 1200
    expect(r.lines).toEqual([
      { productKey: "헤이 180", qty: 10, unitPrice: 2500, supply: 25000, tax: 0, total: 25000, taxFree: true },
      { productKey: "요거트 180", qty: 4, unitPrice: 3000, supply: 12000, tax: 1200, total: 13200, taxFree: false },
    ]);
    expect(r.qtyTotal).toBe(14);
    expect(r.supplyTotal).toBe(37000);
    expect(r.taxTotal).toBe(1200);
    expect(r.total).toBe(38200);
  });

  it("taxFree 맵이 없으면 전부 과세로 계산", () => {
    const r = settleClient(["A"], { A: 2 }, { A: 1000 });
    expect(r.taxTotal).toBe(200);
    expect(r.total).toBe(2200);
  });

  it("세액은 반올림(원 단위)", () => {
    // 공급 3333 × 10% = 333.3 → 333
    const r = settleClient(["A"], { A: 3 }, { A: 1111 }, { A: false });
    expect(r.lines[0].tax).toBe(333);
  });

  it("수량 0 라인은 제외, 음수 단가는 0", () => {
    const r = settleClient(KEYS, { "헤이 180": 0, "헤이 750": 2 }, { "헤이 750": -5 }, TAX_FREE);
    expect(r.lines).toEqual([
      { productKey: "헤이 750", qty: 2, unitPrice: 0, supply: 0, tax: 0, total: 0, taxFree: true },
    ]);
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
