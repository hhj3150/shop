// B2B 매출·정산 — 순수 계산. 거래처별 기간 필요수량(수량)과 단가로 거래명세·매출을 낸다.
//   단가는 '공급 단가(부가세 별도)'. 공급가액 = 수량×단가, 세액 = 과세품이면 공급가×10%(반올림),
//   면세품(우유 등)은 0. 합계 = 공급가액 + 세액. → 세금계산서 근거로 쓸 수 있다.
import type { B2bDemand } from "@/lib/clients";

export type SettlementLine = {
  productKey: string;
  qty: number;
  unitPrice: number; // 공급 단가(부가세 별도)
  supply: number; // 공급가액 = 수량 × 단가
  tax: number; // 세액(과세품 10%, 면세 0)
  total: number; // 합계 = 공급가액 + 세액
  taxFree: boolean;
};

export type ClientSettlement = {
  lines: SettlementLine[];
  qtyTotal: number;
  supplyTotal: number;
  taxTotal: number;
  total: number;
};

// 한 거래처의 라인 계산. 수량이 0인 제품은 제외해 명세를 깔끔히 한다.
//   taxFree[key]=true 인 제품은 세액 0(면세). 없으면 과세로 본다.
export function settleClient(
  productKeys: readonly string[],
  qty: Readonly<Record<string, number>>,
  price: Readonly<Record<string, number>>,
  taxFree: Readonly<Record<string, boolean>> = {}
): ClientSettlement {
  const lines: SettlementLine[] = [];
  let qtyTotal = 0;
  let supplyTotal = 0;
  let taxTotal = 0;
  for (const key of productKeys) {
    const q = qty[key] ?? 0;
    if (q <= 0) continue;
    const unitPrice = Math.max(0, price[key] ?? 0);
    const supply = q * unitPrice;
    const free = taxFree[key] ?? false;
    const tax = free ? 0 : Math.round(supply * 0.1);
    const total = supply + tax;
    lines.push({ productKey: key, qty: q, unitPrice, supply, tax, total, taxFree: free });
    qtyTotal += q;
    supplyTotal += supply;
    taxTotal += tax;
  }
  return { lines, qtyTotal, supplyTotal, taxTotal, total: supplyTotal + taxTotal };
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
