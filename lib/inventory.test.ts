import { describe, it, expect } from "vitest";
import { isLowStock, nextStock, MOVEMENT_KINDS } from "./inventory";

describe("isLowStock", () => {
  it("현재고 ≤ 안전재고 → 부족", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(0, 5)).toBe(true);
  });
  it("현재고 > 안전재고 → 정상", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });
  it("안전재고 NULL(경보 안 함) → 항상 정상", () => {
    expect(isLowStock(0, null)).toBe(false);
  });
  it("현재고 NULL(무제한) → 항상 정상", () => {
    expect(isLowStock(null, 5)).toBe(false);
    expect(isLowStock(null, null)).toBe(false);
  });
});

describe("nextStock", () => {
  it("입고(+)·출고(−) 정상 가감", () => {
    expect(nextStock(10, 5)).toBe(15);
    expect(nextStock(10, -4)).toBe(6);
    expect(nextStock(10, -10)).toBe(0); // 0 까지는 허용
  });
  it("0 미만이 되면 차단(throw)", () => {
    expect(() => nextStock(3, -4)).toThrow(/재고 부족/);
  });
  it("현재고 NULL(무제한) → 변동 무시하고 null 반환", () => {
    expect(nextStock(null, -100)).toBe(null);
    expect(nextStock(null, 50)).toBe(null);
  });
});

describe("MOVEMENT_KINDS", () => {
  it("4종 거래 유형(입고·출고·조정·폐기)", () => {
    expect(MOVEMENT_KINDS).toEqual(["입고", "출고", "조정", "폐기"]);
  });
});
