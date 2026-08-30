import { describe, it, expect } from "vitest";
import { computeCashReceiptAmounts } from "./cash-receipt-tax";

// PayAction 자동발행에 실어 보내는 값이 맞는지 — 잘못 보내면 손님 영수증의 세액이 틀린다.
//   (register 라우트가 computeCashReceiptAmounts 결과의 taxFreeAmount 를 tax_free_amount 로 보낸다.)
describe("현금영수증 자동발행 — 면세금액 산출", () => {
  it("우유 단품(전액 면세)은 면세금액 = 결제액", () => {
    const amt = computeCashReceiptAmounts(
      [{ productId: "milk-950", unitPrice: 9500, qty: 2 }],
      19000,
      { weeks: 1, shippingFee: 0 }
    );
    expect(amt.taxFreeAmount).toBe(19000);
    expect(amt.vat).toBe(0);
    expect(amt.taxFreeAmount + amt.supplyAmount + amt.vat).toBe(amt.total);
  });

  it("우유+요거트 구독: 주수를 빠뜨리면 면세가 모자라고 부가세가 부풀려진다", () => {
    // 회당 우유 9,500 + 요거트 8,000 = 17,500. 4주 구독이라 결제액은 70,000.
    const items = [
      { productId: "milk-950", unitPrice: 9500, qty: 1 },
      { productId: "yogurt-450", unitPrice: 8000, qty: 1 },
    ];
    const total = 17500 * 4;
    const withWeeks = computeCashReceiptAmounts(items, total, { weeks: 4, shippingFee: 0 });
    const withoutWeeks = computeCashReceiptAmounts(items, total, { weeks: 1, shippingFee: 0 });
    // 4주로 세면 우유 4회분(38,000)이 면세로 잡힌다.
    expect(withWeeks.taxFreeAmount).toBe(9500 * 4);
    // 주수를 빼면 1회분만 면세로 잡혀 면세가 모자라고 그만큼 부가세가 커진다.
    expect(withoutWeeks.taxFreeAmount).toBeLessThan(withWeeks.taxFreeAmount);
    expect(withoutWeeks.vat).toBeGreaterThan(withWeeks.vat);
  });

  it("면세+공급가액+부가세 합은 언제나 실결제액과 같다(영수증 불변식)", () => {
    const amt = computeCashReceiptAmounts(
      [
        { productId: "milk-950", unitPrice: 9500, qty: 1 },
        { productId: "yogurt-450", unitPrice: 8000, qty: 1 },
      ],
      21500,
      { weeks: 1, shippingFee: 4000 }
    );
    expect(amt.taxFreeAmount + amt.supplyAmount + amt.vat).toBe(21500);
  });
});
