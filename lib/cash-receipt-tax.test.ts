import { describe, it, expect } from "vitest";
import {
  computeCashReceiptAmounts,
  isTaxFreeProduct,
  type ReceiptItem,
} from "./cash-receipt-tax";

describe("isTaxFreeProduct", () => {
  it("우유는 면세, 요거트는 과세", () => {
    expect(isTaxFreeProduct("milk-180")).toBe(true);
    expect(isTaxFreeProduct("milk-750")).toBe(true);
    expect(isTaxFreeProduct("yogurt-180")).toBe(false);
    expect(isTaxFreeProduct("yogurt-500")).toBe(false);
  });
  it("모르는 id 는 milk- 접두사로 보수적 판단", () => {
    expect(isTaxFreeProduct("milk-unknown")).toBe(true);
    expect(isTaxFreeProduct("something")).toBe(false);
  });
});

describe("computeCashReceiptAmounts", () => {
  it("우유만(면세) — 배송비도 면세, 부가세 0", () => {
    const items: ReceiptItem[] = [{ productId: "milk-750", unitPrice: 9000, qty: 2 }];
    const total = 18000 + 4000; // 품목 + 배송비
    const r = computeCashReceiptAmounts(items, total);
    expect(r).toEqual({ total: 22000, taxFreeAmount: 22000, supplyAmount: 0, vat: 0 });
  });

  it("요거트만(과세) — 포함가에서 부가세 역산, 배송비 과세", () => {
    const items: ReceiptItem[] = [{ productId: "yogurt-500", unitPrice: 11000, qty: 1 }];
    const total = 11000 + 4000; // 15000 (부가세 포함)
    const r = computeCashReceiptAmounts(items, total);
    expect(r.total).toBe(15000);
    expect(r.taxFreeAmount).toBe(0);
    expect(r.supplyAmount).toBe(Math.round(15000 / 1.1)); // 13636
    expect(r.supplyAmount + r.vat).toBe(15000);
  });

  it("우유+요거트 혼합 — 면세/과세 분리, 배송비는 과세, 합은 총액과 일치", () => {
    const items: ReceiptItem[] = [
      { productId: "milk-750", unitPrice: 9000, qty: 1 }, // 면세 9000
      { productId: "yogurt-500", unitPrice: 11000, qty: 1 }, // 과세 11000
    ];
    const total = 9000 + 11000 + 4000; // 24000
    const r = computeCashReceiptAmounts(items, total);
    expect(r.taxFreeAmount).toBe(9000);
    const taxableInclusive = 11000 + 4000; // 15000
    expect(r.supplyAmount).toBe(Math.round(taxableInclusive / 1.1));
    expect(r.vat).toBe(taxableInclusive - r.supplyAmount);
    // 핵심 불변식: 세 항목 합 = 총액
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });

  it("어떤 구성이든 면세+공급가액+부가세 = 총액 (불변식)", () => {
    const cases: { items: ReceiptItem[]; total: number }[] = [
      { items: [{ productId: "milk-180", unitPrice: 4500, qty: 3 }], total: 4500 * 3 + 5000 },
      { items: [{ productId: "yogurt-180", unitPrice: 5000, qty: 2 }], total: 5000 * 2 + 4000 },
      {
        items: [
          { productId: "milk-180", unitPrice: 4500, qty: 1 },
          { productId: "yogurt-180", unitPrice: 5000, qty: 2 },
        ],
        total: 4500 + 10000 + 4000,
      },
    ];
    for (const c of cases) {
      const r = computeCashReceiptAmounts(c.items, c.total);
      expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(c.total);
    }
  });
});
