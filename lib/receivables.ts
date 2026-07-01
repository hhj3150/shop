// B2B 미수금 — 순수 계산. 청구 합계 − 입금 합계 = 미수 잔액(거래처별).
import type { ClientInvoice, ClientPayment } from "@/lib/clients";

export type Balance = { billed: number; paid: number; balance: number };

// 거래처별 청구·입금 합계와 미수 잔액. 청구·입금이 하나라도 있는 거래처만 포함.
export function clientBalances(
  invoices: readonly ClientInvoice[],
  payments: readonly ClientPayment[]
): Record<string, Balance> {
  const out: Record<string, Balance> = {};
  const ensure = (id: string): Balance => (out[id] ??= { billed: 0, paid: 0, balance: 0 });
  for (const inv of invoices) ensure(inv.client_id).billed += Math.max(0, inv.total ?? 0);
  for (const p of payments) ensure(p.client_id).paid += Math.max(0, p.amount ?? 0);
  for (const id of Object.keys(out)) out[id].balance = out[id].billed - out[id].paid;
  return out;
}

// 전체 합계(총청구·총입금·총미수).
export function totalBalance(balances: Record<string, Balance>): Balance {
  return Object.values(balances).reduce(
    (a, b) => ({ billed: a.billed + b.billed, paid: a.paid + b.paid, balance: a.balance + b.balance }),
    { billed: 0, paid: 0, balance: 0 }
  );
}
