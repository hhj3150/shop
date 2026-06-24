import { describe, it, expect } from "vitest";
import { normalizeBillingName } from "./depositor-name";

// 입금자명 정규화 — PayAction 자동매칭이 깨지던 '괄호 메모' 케이스(이경원원장(98예준))를
//   통장 보내는분 이름과 정합하게 다듬는지 검증한다. 선두 괄호 상호는 보존한다.
describe("normalizeBillingName", () => {
  it("이름 뒤 괄호 메모 제거", () => {
    expect(normalizeBillingName("이경원원장(98예준)")).toBe("이경원원장");
  });

  it("이름과 괄호 사이 공백까지 흡수", () => {
    expect(normalizeBillingName("이경원원장 (98예준)")).toBe("이경원원장");
  });

  it("대괄호·전각 괄호 메모도 제거", () => {
    expect(normalizeBillingName("홍길동[메모]")).toBe("홍길동");
    expect(normalizeBillingName("홍길동（예준）")).toBe("홍길동");
  });

  it("선두 괄호(상호 일부)는 보존", () => {
    expect(normalizeBillingName("(주)디투오")).toBe("(주)디투오");
  });

  it("메모 없는 평범한 이름은 그대로(공백만 정리)", () => {
    expect(normalizeBillingName("  홍길동  ")).toBe("홍길동");
    expect(normalizeBillingName("홍 길동")).toBe("홍 길동");
  });

  it("null/빈 입력은 빈 문자열", () => {
    expect(normalizeBillingName(null)).toBe("");
    expect(normalizeBillingName(undefined)).toBe("");
    expect(normalizeBillingName("   ")).toBe("");
  });
});
