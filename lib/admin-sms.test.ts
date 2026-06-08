import { describe, it, expect } from "vitest";
import { SMS_PRESETS, fillPreset } from "./admin-sms";

describe("SMS_PRESETS", () => {
  it("프리셋 2개(주문 미완료·입금 안내)를 제공한다", () => {
    expect(SMS_PRESETS.map((p) => p.key)).toEqual(["order_incomplete", "payment_pending"]);
  });
});

describe("fillPreset", () => {
  it("{이름}을 회원 이름으로 치환한다", () => {
    const text = fillPreset("order_incomplete", "우혜원");
    expect(text).toContain("우혜원님");
    expect(text).not.toContain("{이름}");
  });
  it("이름이 비면 '고객'으로 채운다", () => {
    expect(fillPreset("payment_pending", "")).toContain("고객님");
  });
  it("없는 키는 빈 문자열", () => {
    expect(fillPreset("nope", "우혜원")).toBe("");
  });
});
