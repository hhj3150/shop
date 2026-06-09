import { describe, it, expect } from "vitest";
import { giftSenderLabel, giftSenderCsv } from "./gift";

describe("giftSenderLabel", () => {
  it("일반 주문은 null", () => {
    expect(giftSenderLabel(false, null)).toBeNull();
    expect(giftSenderLabel(null, "홍길동")).toBeNull();
  });
  it("선물 + 보낸이 이름", () => {
    expect(giftSenderLabel(true, "홍길동")).toBe("선물 · 보낸이 홍길동");
  });
  it("선물인데 이름 없으면 '선물'", () => {
    expect(giftSenderLabel(true, null)).toBe("선물");
    expect(giftSenderLabel(true, "  ")).toBe("선물");
  });
});

describe("giftSenderCsv", () => {
  it("일반은 빈 문자열", () => {
    expect(giftSenderCsv(false, "홍길동")).toBe("");
  });
  it("선물은 보낸이(없으면 '선물')", () => {
    expect(giftSenderCsv(true, "홍길동")).toBe("홍길동");
    expect(giftSenderCsv(true, "")).toBe("선물");
  });
});
