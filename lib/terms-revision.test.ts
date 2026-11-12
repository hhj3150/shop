import { describe, it, expect } from "vitest";
import { TERMS_REVISION, revisedTermsInEffect } from "./terms-revision";

describe("이용약관 개정 일정 — 약관 제3조(7일 전 공지)", () => {
  it("시행일은 공지일로부터 7일 이상 뒤", () => {
    const days =
      (Date.parse(TERMS_REVISION.effective) - Date.parse(TERMS_REVISION.announced)) / 86400000;
    expect(days).toBeGreaterThanOrEqual(7);
  });
  it("시행일 전날까지는 현행, 시행일부터 개정", () => {
    expect(revisedTermsInEffect("2026-11-18")).toBe(false);
    expect(revisedTermsInEffect(TERMS_REVISION.effective)).toBe(true);
  });
});
