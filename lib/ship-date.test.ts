import { describe, it, expect } from "vitest";
import { firstDeliveryOnOrAfter } from "./ship-date";

// 2026-08-01 = 토, 08-03 = 월, 08-05 = 수, 08-07 = 금.
describe("firstDeliveryOnOrAfter", () => {
  it("기준일이 주말이면 그 이후 첫 해당 요일", () => {
    // 8/1(토) 이후 첫 월요일 = 8/3
    expect(firstDeliveryOnOrAfter("mon", "2026-08-01")).toBe("2026-08-03");
  });

  it("기준일이 그 요일이면 기준일을 그대로(on/after 포함)", () => {
    expect(firstDeliveryOnOrAfter("mon", "2026-08-03")).toBe("2026-08-03");
  });

  it("기준일 이후 가장 가까운 해당 요일", () => {
    expect(firstDeliveryOnOrAfter("wed", "2026-08-03")).toBe("2026-08-05");
    expect(firstDeliveryOnOrAfter("fri", "2026-08-03")).toBe("2026-08-07");
  });

  it("같은 주 지난 요일이면 다음 주", () => {
    // 8/5(수) 기준 월요일 → 다음 주 월 8/10
    expect(firstDeliveryOnOrAfter("mon", "2026-08-05")).toBe("2026-08-10");
  });
});
