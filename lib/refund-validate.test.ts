import { describe, it, expect } from "vitest";
import { refundWarnings, REFUND_WARNING_LABEL } from "@/lib/refund-validate";

describe("refundWarnings", () => {
  it("정상 환불(0 < 금액 ≤ 주문금액) → 경고 없음", () => {
    expect(refundWarnings({ type: "환불", amount: 25000, orderTotal: 25000 })).toEqual([]);
    expect(refundWarnings({ type: "환불", amount: 10000, orderTotal: 25000 })).toEqual([]);
  });

  it("환불금액이 주문금액보다 크면 EXCEEDS_TOTAL", () => {
    expect(
      refundWarnings({ type: "환불", amount: 250000, orderTotal: 25000 })
    ).toContain("EXCEEDS_TOTAL");
  });

  it("환불 유형인데 금액 0(또는 음수) → ZERO_REFUND", () => {
    expect(refundWarnings({ type: "환불", amount: 0, orderTotal: 25000 })).toContain("ZERO_REFUND");
    expect(refundWarnings({ type: "환불", amount: -5, orderTotal: 25000 })).toContain("ZERO_REFUND");
  });

  it("교환은 금액 0이어도 ZERO_REFUND 아님(환불 아님)", () => {
    expect(refundWarnings({ type: "교환", amount: 0, orderTotal: 25000 })).toEqual([]);
  });

  it("교환이라도 금액이 주문금액 초과면 EXCEEDS_TOTAL", () => {
    expect(
      refundWarnings({ type: "교환", amount: 30000, orderTotal: 25000 })
    ).toEqual(["EXCEEDS_TOTAL"]);
  });

  it("숫자가 아니면 0으로 본다(환불 → ZERO_REFUND)", () => {
    expect(refundWarnings({ type: "환불", amount: NaN, orderTotal: 25000 })).toContain("ZERO_REFUND");
  });

  it("모든 경고 코드에 라벨이 있다", () => {
    for (const code of ["EXCEEDS_TOTAL", "ZERO_REFUND"] as const) {
      expect(REFUND_WARNING_LABEL[code]).toBeTruthy();
    }
  });
});
