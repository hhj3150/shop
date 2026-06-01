import { describe, it, expect } from "vitest";
import {
  memberDiscountPercent,
  buildMembershipBenefits,
} from "./membership-benefits";
import { BASE_DISCOUNT, SUB_TOTAL_CAP } from "./products";

describe("memberDiscountPercent", () => {
  it("SSOT BASE_DISCOUNT에서 정수 퍼센트를 파생한다", () => {
    expect(memberDiscountPercent()).toBe(Math.round(BASE_DISCOUNT * 100));
  });
});

describe("buildMembershipBenefits", () => {
  it("모든 항목은 비어있지 않은 title/desc를 갖는다", () => {
    const benefits = buildMembershipBenefits();
    expect(benefits.length).toBeGreaterThanOrEqual(3);
    for (const b of benefits) {
      expect(b.title.trim().length).toBeGreaterThan(0);
      expect(b.desc.trim().length).toBeGreaterThan(0);
    }
  });

  it("할인 혜택 문구는 SSOT 퍼센트를 그대로 반영한다(드리프트 방지)", () => {
    const benefits = buildMembershipBenefits();
    const pct = `${memberDiscountPercent()}%`;
    expect(benefits.some((b) => b.title.includes(pct))).toBe(true);
  });

  it("한정 혜택 문구는 SSOT 정원(SUB_TOTAL_CAP)을 반영한다", () => {
    const benefits = buildMembershipBenefits();
    expect(benefits.some((b) => b.title.includes(String(SUB_TOTAL_CAP)))).toBe(
      true
    );
  });
});
