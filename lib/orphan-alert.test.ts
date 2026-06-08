import { describe, it, expect } from "vitest";
import { buildOrphanAlertText } from "./orphan-alert";

describe("buildOrphanAlertText", () => {
  it("주문번호·수령인·금액·수단을 모두 포함한다", () => {
    const text = buildOrphanAlertText({
      orderNo: "A1B2-3C4D",
      shipName: "김종민",
      shipPhone: "01012345678",
      paidAmount: 64000,
      payMethod: "무통장입금",
    });
    expect(text).toContain("고아입금");
    expect(text).toContain("A1B2-3C4D");
    expect(text).toContain("김종민");
    expect(text).toContain("01012345678");
    expect(text).toContain("64,000원"); // 천단위 콤마
    expect(text).toContain("무통장입금");
  });

  it("누락 필드는 안전한 기본 문구로 대체한다", () => {
    const text = buildOrphanAlertText({
      orderNo: "X9",
      shipName: null,
      shipPhone: null,
      paidAmount: null,
      payMethod: null,
    });
    expect(text).toContain("X9");
    expect(text).toContain("이름미상");
    expect(text).toContain("연락처미상");
    expect(text).toContain("금액미상");
    expect(text).toContain("수단미상");
  });
});
