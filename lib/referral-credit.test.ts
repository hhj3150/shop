import { describe, it, expect } from "vitest";
import { usableBalance, redeemableCoupons, type RewardLite } from "./referral-credit";

const NOW = "2026-06-08T00:00:00Z";
function rw(over: Partial<RewardLite> = {}): RewardLite {
  return { amount_krw: 5000, status: "earned", expires_at: "2027-01-01T00:00:00Z", ...over };
}

describe("usableBalance", () => {
  it("유효(earned·미만료)만 합산한다", () => {
    const b = usableBalance(
      [rw(), rw(), rw({ status: "applied" }), rw({ status: "void" })],
      NOW
    );
    expect(b).toEqual({ count: 2, krw: 10000 });
  });
  it("만료된 earned 는 제외한다", () => {
    const b = usableBalance([rw({ expires_at: "2026-01-01T00:00:00Z" }), rw()], NOW);
    expect(b).toEqual({ count: 1, krw: 5000 });
  });
  it("만료 경계(만료일 == now)는 만료로 본다", () => {
    const b = usableBalance([rw({ expires_at: NOW })], NOW);
    expect(b).toEqual({ count: 0, krw: 0 });
  });
  it("빈 배열이면 0", () => {
    expect(usableBalance([], NOW)).toEqual({ count: 0, krw: 0 });
  });
});

describe("redeemableCoupons", () => {
  it("입금액 한도 내에서 5,000원 단위로 차감한다", () => {
    // 입금액 32,400 · 잔액 10장 → 6장(30,000) 차감, 2,400 입금
    expect(redeemableCoupons({ availableCount: 10, orderTotal: 32400 })).toEqual({
      useCount: 6,
      creditKrw: 30000,
      payable: 2400,
    });
  });
  it("잔액이 부족하면 가진 만큼만", () => {
    expect(redeemableCoupons({ availableCount: 2, orderTotal: 50000 })).toEqual({
      useCount: 2,
      creditKrw: 10000,
      payable: 40000,
    });
  });
  it("정확히 배수면 0원 입금", () => {
    expect(redeemableCoupons({ availableCount: 10, orderTotal: 30000 })).toEqual({
      useCount: 6,
      creditKrw: 30000,
      payable: 0,
    });
  });
  it("잔액 0장이면 차감 없음", () => {
    expect(redeemableCoupons({ availableCount: 0, orderTotal: 30000 })).toEqual({
      useCount: 0,
      creditKrw: 0,
      payable: 30000,
    });
  });
  it("payable 은 항상 0 이상", () => {
    const r = redeemableCoupons({ availableCount: 100, orderTotal: 27000 });
    expect(r.payable).toBeGreaterThanOrEqual(0);
    expect(r.creditKrw).toBeLessThanOrEqual(27000);
  });
});
