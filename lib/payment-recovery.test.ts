import { describe, it, expect } from "vitest";
import { decideAction, type RecoveryTarget } from "./payment-recovery";

const base: RecoveryTarget = {
  orderId: "o1",
  createdAt: "2026-06-01T01:00:00.000Z", // 2026-06-01 10:00 KST
  shipName: "홍길동",
  shipPhone: "01012345678",
  orderNo: "20260601-0001",
  totalAmount: 39000,
  hasSubscription: true,
  sentStages: [],
};

describe("decideAction (KST 달력일 경과)", () => {
  it("D+0 당일은 none", () => {
    const now = new Date("2026-06-01T05:00:00.000Z"); // 같은 날 14:00 KST
    expect(decideAction(base, now)).toBe("none");
  });
  it("D+1은 D1", () => {
    const now = new Date("2026-06-02T00:30:00.000Z"); // 06-02 09:30 KST
    expect(decideAction(base, now)).toBe("D1");
  });
  it("D+1인데 이미 D1 보냈으면 none", () => {
    const now = new Date("2026-06-02T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D1"] }, now)).toBe("none");
  });
  it("D+2는 D2", () => {
    const now = new Date("2026-06-03T00:30:00.000Z"); // 06-03 09:30 KST
    expect(decideAction(base, now)).toBe("D2");
  });
  it("D+2인데 이미 D2 보냈으면 none", () => {
    const now = new Date("2026-06-03T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D2"] }, now)).toBe("none");
  });
  it("D+3 이상은 EXPIRE", () => {
    const now = new Date("2026-06-04T00:30:00.000Z"); // 06-04 09:30 KST
    expect(decideAction(base, now)).toBe("EXPIRE");
  });
  it("KST 자정 직후 경계: UTC로는 전날이어도 KST 달력일로 계산", () => {
    // created 06-01 10:00 KST. now = 06-02 00:10 KST (= 06-01T15:10Z)
    const now = new Date("2026-06-01T15:10:00.000Z");
    expect(decideAction(base, now)).toBe("D1");
  });
});
