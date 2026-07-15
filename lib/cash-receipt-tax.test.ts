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

// ───── 구독 주문: order_items 는 '회당' 수량, total 은 전체 기간(주수)분 ─────
//   weeks(orders.block_weeks)와 shippingFee(orders.shipping_fee)를 넘겨야
//   면세/과세가 바르게 갈린다. 단가는 기간 할인 적용가(10/12/15%).
describe("computeCashReceiptAmounts — 정기구독(주수 반영)", () => {
  // 우유 750×2 + 요거트 500×1 매주, 일반지역(회당 4,000원)
  const mixed = (milkUnit: number, yogUnit: number): ReceiptItem[] => [
    { productId: "milk-750", unitPrice: milkUnit, qty: 2 },
    { productId: "yogurt-500", unitPrice: yogUnit, qty: 1 },
  ];

  it("4주(10%) 혼합 — 면세=우유 4주분, 과세=요거트 4주분+배송비", () => {
    const total = 30600 * 4 + 16000; // 138,400 (서버 total_amount 산식과 동일)
    const r = computeCashReceiptAmounts(mixed(10800, 9000), total, {
      weeks: 4,
      shippingFee: 16000,
    });
    expect(r.taxFreeAmount).toBe(10800 * 2 * 4); // 86,400
    const taxable = 9000 * 4 + 16000; // 52,000
    expect(r.supplyAmount).toBe(Math.round(taxable / 1.1)); // 47,273
    expect(r.vat).toBe(taxable - r.supplyAmount); // 4,727
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });

  it("8주(12%) 혼합 — 주수를 빼먹으면 생기던 부가세 과대가 없어야 한다", () => {
    const total = 29920 * 8 + 32000; // 271,360
    const r = computeCashReceiptAmounts(mixed(10560, 8800), total, {
      weeks: 8,
      shippingFee: 32000,
    });
    expect(r.taxFreeAmount).toBe(10560 * 2 * 8); // 168,960
    const taxable = 8800 * 8 + 32000; // 102,400
    expect(r.supplyAmount).toBe(93091);
    expect(r.vat).toBe(taxable - 93091); // 9,309
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });

  it("12주(15%) 혼합", () => {
    const total = 28900 * 12 + 48000; // 394,800
    const r = computeCashReceiptAmounts(mixed(10200, 8500), total, {
      weeks: 12,
      shippingFee: 48000,
    });
    expect(r.taxFreeAmount).toBe(10200 * 2 * 12); // 244,800
    const taxable = 8500 * 12 + 48000; // 150,000
    expect(r.supplyAmount).toBe(Math.round(taxable / 1.1)); // 136,364
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });

  it("우유만 8주 — 전액 면세, 부가세 0", () => {
    const items: ReceiptItem[] = [{ productId: "milk-750", unitPrice: 10560, qty: 3 }];
    const total = 10560 * 3 * 8 + 32000; // 285,440
    const r = computeCashReceiptAmounts(items, total, { weeks: 8, shippingFee: 32000 });
    expect(r).toEqual({ total, taxFreeAmount: total, supplyAmount: 0, vat: 0 });
  });

  it("방문수령 구독(배송비 0) 혼합 8주", () => {
    const total = 29920 * 8; // 239,360
    const r = computeCashReceiptAmounts(mixed(10560, 8800), total, {
      weeks: 8,
      shippingFee: 0,
    });
    expect(r.taxFreeAmount).toBe(10560 * 2 * 8); // 168,960
    expect(r.supplyAmount).toBe(64000); // 70,400 / 1.1
    expect(r.vat).toBe(6400);
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });
});

// ───── 적립금 차감: total(실결제액) < 품목+배송 — 발행액이 실결제액을 넘으면 안 된다 ─────
describe("computeCashReceiptAmounts — 적립금 차감(실결제액 불변식)", () => {
  it("전부 면세 + 차감 — 면세금액이 실결제액으로 줄어든다", () => {
    const items: ReceiptItem[] = [{ productId: "milk-750", unitPrice: 12000, qty: 2 }];
    const total = 24000 + 4000 - 10000; // 실결제 18,000 (적립금 10,000)
    const r = computeCashReceiptAmounts(items, total, { weeks: 1, shippingFee: 4000 });
    expect(r).toEqual({ total: 18000, taxFreeAmount: 18000, supplyAmount: 0, vat: 0 });
  });

  it("혼합 + 차감 — 차감액을 면세/과세에 비례 배분, 합=실결제액", () => {
    const items: ReceiptItem[] = [
      { productId: "milk-750", unitPrice: 12000, qty: 1 },
      { productId: "yogurt-500", unitPrice: 10000, qty: 1 },
    ];
    const total = 12000 + 10000 + 4000 - 5000; // 실결제 21,000 (적립금 5,000)
    const r = computeCashReceiptAmounts(items, total, { weeks: 1, shippingFee: 4000 });
    // gross 26,000 중 면세 12,000·과세 14,000 → 차감 5,000 을 비례 배분
    expect(r.taxFreeAmount).toBe(12000 - 2308); // 9,692
    expect(r.supplyAmount + r.vat).toBe(14000 - 2692); // 11,308
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
  });

  it("shippingFee 미지정(구버전 호환) — 차감이 배송비를 넘어도 합=실결제액", () => {
    const items: ReceiptItem[] = [{ productId: "milk-750", unitPrice: 12000, qty: 2 }];
    const total = 24000 + 4000 - 10000; // 18,000. 배송비 정보 없음 → 추정 0
    const r = computeCashReceiptAmounts(items, total);
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
    expect(r.vat).toBe(0);
  });

  it("구독 + 차감 — 주수 반영 뒤 비례 배분해도 불변식 유지", () => {
    const items: ReceiptItem[] = [
      { productId: "milk-750", unitPrice: 10560, qty: 2 },
      { productId: "yogurt-500", unitPrice: 8800, qty: 1 },
    ];
    const total = 29920 * 8 + 32000 - 15000; // 256,360
    const r = computeCashReceiptAmounts(items, total, { weeks: 8, shippingFee: 32000 });
    expect(r.taxFreeAmount + r.supplyAmount + r.vat).toBe(total);
    // 차감 15,000 을 면세:과세 = 168,960:102,400 으로 비례 배분 → 면세측 9,340 차감.
    expect(r.taxFreeAmount).toBe(168960 - 9340); // 159,620
    expect(r.supplyAmount + r.vat).toBe(102400 - 5660); // 96,740
  });
});
