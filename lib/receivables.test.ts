import { describe, expect, it } from "vitest";
import { clientBalances, totalBalance } from "./receivables";
import type { ClientInvoice, ClientPayment } from "./clients";

const inv = (client_id: string, total: number): ClientInvoice => ({
  client_id, period_from: "2026-07-01", period_to: "2026-07-31", supply: total, tax: 0, total,
});
const pay = (client_id: string, amount: number): ClientPayment => ({
  client_id, paid_on: "2026-07-15", amount,
});

describe("clientBalances", () => {
  it("청구−입금 = 미수 (거래처별)", () => {
    const b = clientBalances(
      [inv("A", 100000), inv("A", 50000), inv("B", 30000)],
      [pay("A", 120000)]
    );
    expect(b.A).toEqual({ billed: 150000, paid: 120000, balance: 30000 });
    expect(b.B).toEqual({ billed: 30000, paid: 0, balance: 30000 });
  });

  it("입금이 청구보다 많으면 미수 음수(선수금)", () => {
    const b = clientBalances([inv("A", 10000)], [pay("A", 15000)]);
    expect(b.A.balance).toBe(-5000);
  });

  it("청구·입금 없는 거래처는 포함 안 됨", () => {
    const b = clientBalances([inv("A", 1000)], []);
    expect(Object.keys(b)).toEqual(["A"]);
  });

  it("전체 합계", () => {
    const b = clientBalances([inv("A", 100), inv("B", 200)], [pay("A", 50)]);
    expect(totalBalance(b)).toEqual({ billed: 300, paid: 50, balance: 250 });
  });
});
