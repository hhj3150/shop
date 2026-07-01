// 원가·수익성 — 순수 계산. 매출 − 매출원가(COGS) = 이익. 제품별·전체.
//   매출 = 온라인 수량 × 판매가 + B2B 매출(거래처 단가 반영).
//   COGS = 원가단가 × 총 판매수량(온라인 + B2B). 이익률 = 이익 / 매출.

export type ProfitInput = {
  productKey: string;
  onlineQty: number;
  b2bQty: number;
  b2bRevenue: number; // Σ(거래처별 B2B 수량 × 거래처 단가)
  cost: number; // 원가 단가
  price: number; // 온라인 판매가
};

export type ProfitLine = {
  productKey: string;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number; // 이익/매출×100 (매출 0이면 0), 소수 1자리
};

export function profitLine(i: ProfitInput): ProfitLine {
  const qty = Math.max(0, i.onlineQty) + Math.max(0, i.b2bQty);
  const revenue = Math.max(0, i.onlineQty) * Math.max(0, i.price) + Math.max(0, i.b2bRevenue);
  const cogs = Math.max(0, i.cost) * qty;
  const profit = revenue - cogs;
  const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
  return { productKey: i.productKey, qty, revenue, cogs, profit, marginPct };
}

export type ProfitTotals = { revenue: number; cogs: number; profit: number; marginPct: number };

export function profitTotals(lines: readonly ProfitLine[]): ProfitTotals {
  const revenue = lines.reduce((s, l) => s + l.revenue, 0);
  const cogs = lines.reduce((s, l) => s + l.cogs, 0);
  const profit = revenue - cogs;
  const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
  return { revenue, cogs, profit, marginPct };
}
