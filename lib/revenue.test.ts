import { describe, it, expect } from "vitest";
import {
  cancellationRefundTotal,
  completedReturnRefundTotal,
  netRevenue,
  type RefundSlotLite,
  type ReturnLite,
} from "./revenue";

describe("cancellationRefundTotal", () => {
  it("해지 슬롯의 refund_amount만 합산한다", () => {
    const slots: RefundSlotLite[] = [
      { status: "해지", refund_amount: 30000 },
      { status: "해지", refund_amount: 12000 },
      { status: "활성", refund_amount: 99999 }, // 해지 아님 → 제외
      { status: "신청", refund_amount: null },
    ];
    expect(cancellationRefundTotal(slots)).toBe(42000);
  });

  it("null·undefined refund_amount는 0으로 본다", () => {
    const slots: RefundSlotLite[] = [
      { status: "해지", refund_amount: null },
      { status: "해지" },
      { status: "해지", refund_amount: 5000 },
    ];
    expect(cancellationRefundTotal(slots)).toBe(5000);
  });

  it("빈 배열은 0", () => {
    expect(cancellationRefundTotal([])).toBe(0);
  });
});

describe("completedReturnRefundTotal", () => {
  it("type='환불' AND status='완료' 인 amount만 합산한다", () => {
    const returns: ReturnLite[] = [
      { type: "환불", status: "완료", amount: 10000 },
      { type: "환불", status: "완료", amount: 7000 },
      { type: "환불", status: "접수", amount: 50000 }, // 미완료 → 제외
      { type: "환불", status: "승인", amount: 50000 }, // 미완료 → 제외
      { type: "교환", status: "완료", amount: 50000 }, // 교환 → 제외
    ];
    expect(completedReturnRefundTotal(returns)).toBe(17000);
  });

  it("반려된 환불은 제외한다", () => {
    const returns: ReturnLite[] = [
      { type: "환불", status: "반려", amount: 9000 },
      { type: "환불", status: "완료", amount: 3000 },
    ];
    expect(completedReturnRefundTotal(returns)).toBe(3000);
  });

  it("빈 배열은 0", () => {
    expect(completedReturnRefundTotal([])).toBe(0);
  });
});

describe("netRevenue", () => {
  it("총매출에서 해지·환불을 차감한다", () => {
    expect(netRevenue(1_000_000, 42000, 17000)).toBe(941000);
  });

  it("차감액이 총매출을 초과하면 0으로 클램프한다", () => {
    expect(netRevenue(10000, 8000, 5000)).toBe(0);
  });

  it("차감이 없으면 총매출 그대로", () => {
    expect(netRevenue(500000, 0, 0)).toBe(500000);
  });
});
