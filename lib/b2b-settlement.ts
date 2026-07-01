// B2B 매출·정산 — 순수 계산. 거래처별 기간 필요수량(수량)과 단가로 거래명세·매출을 낸다.
//   qty × unit_price = amount. 제품별 라인 + 거래처 소계 + 전체 합계.
import type { B2bDemand } from "@/lib/clients";

export type SettlementLine = {
  productKey: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type ClientSettlement = {
  lines: SettlementLine[];
  qtyTotal: number;
  amountTotal: number;
};

// 한 거래처의 라인 계산. 수량이 0인 제품은 제외해 명세를 깔끔히 한다.
export function settleClient(
  productKeys: readonly string[],
  qty: Readonly<Record<string, number>>,
  price: Readonly<Record<string, number>>
): ClientSettlement {
  const lines: SettlementLine[] = [];
  let qtyTotal = 0;
  let amountTotal = 0;
  for (const key of productKeys) {
    const q = qty[key] ?? 0;
    if (q <= 0) continue;
    const unitPrice = Math.max(0, price[key] ?? 0);
    const amount = q * unitPrice;
    lines.push({ productKey: key, qty: q, unitPrice, amount });
    qtyTotal += q;
    amountTotal += amount;
  }
  return { lines, qtyTotal, amountTotal };
}

// b2b_demand 행들을 활성 거래처만 골라 client_id → (product_key → 기간 합계수량)으로 집계.
export function aggregateDemandByClient(
  rows: readonly B2bDemand[],
  activeIds: ReadonlySet<string>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    if (!activeIds.has(r.client_id)) continue;
    const bucket = (out[r.client_id] ??= {});
    bucket[r.product_key] = (bucket[r.product_key] ?? 0) + (r.qty ?? 0);
  }
  return out;
}
