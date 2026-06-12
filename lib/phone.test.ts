import { describe, it, expect } from "vitest";
import { normalizePhone, phone7 } from "./phone";

describe("normalizePhone", () => {
  it("하이픈/공백 제거", () => {
    expect(normalizePhone("010-7663-1234")).toBe("01076631234");
  });
  it("+82 국가코드를 0으로", () => {
    expect(normalizePhone("+82 10-7663-1234")).toBe("01076631234");
    expect(normalizePhone("821076631234")).toBe("01076631234");
  });
  it("null/빈값은 빈문자", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("phone7", () => {
  it("정규화 후 앞 7자리", () => {
    expect(phone7("010-7663-1234")).toBe("0107663");
    expect(phone7("+82 10-7663-1234")).toBe("0107663");
  });
  it("7자리 미만이면 빈문자", () => {
    expect(phone7("010-12")).toBe("");
    expect(phone7(null)).toBe("");
  });
});
