import { describe, it, expect } from "vitest";
import { decideAction, buildRecoveryMessage, type RecoveryTarget } from "./payment-recovery";
import { DEPOSIT } from "./site";

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

describe("buildRecoveryMessage", () => {
  const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;

  it("D1은 PAYMENT_GUIDE 템플릿 + 정확한 변수", () => {
    const m = buildRecoveryMessage(base, "D1");
    expect(m.templateKey).toBe("PAYMENT_GUIDE");
    expect(m.variables).toEqual({
      "#{고객명}": "홍길동",
      "#{주문번호}": "20260601-0001",
      "#{금액}": "39000",
      "#{입금계좌}": account,
    });
    expect(m.text).toContain("39000");
    expect(m.text).toContain(account);
  });

  it("D2는 PAYMENT_DEADLINE 템플릿 + 마감일(D+3, KST)", () => {
    const m = buildRecoveryMessage(base, "D2");
    expect(m.templateKey).toBe("PAYMENT_DEADLINE");
    expect(m.variables).toEqual({
      "#{고객명}": "홍길동",
      "#{주문번호}": "20260601-0001",
      "#{금액}": "39000",
      "#{마감일}": "6월 4일", // 06-01 + 3일 (KST)
    });
  });
});
