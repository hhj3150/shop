import { describe, it, expect } from "vitest";
import { depositAmountDigits } from "./deposit-guidance";

describe("depositAmountDigits", () => {
  it("금액을 은행 앱에 붙여넣을 숫자만 문자열로 반환", () => {
    expect(depositAmountDigits(39000)).toBe("39000");
  });

  it("소수는 반올림하여 정수 문자열로", () => {
    expect(depositAmountDigits(38999.6)).toBe("39000");
  });

  it("0 이하나 유효하지 않은 값은 빈 문자열", () => {
    expect(depositAmountDigits(0)).toBe("");
    expect(depositAmountDigits(-100)).toBe("");
    expect(depositAmountDigits(Number.NaN)).toBe("");
    expect(depositAmountDigits(Number.POSITIVE_INFINITY)).toBe("");
  });
});
