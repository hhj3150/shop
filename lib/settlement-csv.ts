// 정산(월) CSV 행 빌더 — 모든 행을 헤더와 동일한 6칸으로 정렬한다.
//   합계 금액을 라벨 옆(2번째 칸)이 아니라 해당 컬럼(매출/원가/마진)에 놓아,
//   엑셀에서 컬럼이 어긋나던 문제를 구조적으로 막는다.

export const SETTLEMENT_CSV_HEADER = [
  "제품",
  "용량",
  "수량",
  "매출",
  "원가",
  "마진",
] as const;

// 컬럼 인덱스(헤더 순서와 일치).
const COL = { product: 0, volume: 1, qty: 2, revenue: 3, cost: 4, margin: 5 } as const;
const WIDTH = SETTLEMENT_CSV_HEADER.length;

export type SettlementCsvRow = {
  name: string;
  volume: string;
  qty: number;
  revenue: number;
  cost: number;
  margin: number;
};

export type SettlementCsvSummary = {
  rows: SettlementCsvRow[];
  taxableGross: number;
  taxFreeGross: number;
  supply: number;
  vat: number;
  revenue: number;
  totalCost: number;
  margin: number;
};

// 라벨(0번 칸) + 지정 컬럼에 금액을 둔 6칸 행.
function metricRow(label: string, colIndex: number, value: number): string[] {
  const row = Array<string>(WIDTH).fill("");
  row[COL.product] = label;
  row[colIndex] = String(value);
  return row;
}

// 정산 CSV 전체 행(헤더 + 품목 + 빈줄 + 합계 블록)을 만든다. 모두 6칸·문자열.
export function buildSettlementCsvRows(summary: SettlementCsvSummary): string[][] {
  const header = [...SETTLEMENT_CSV_HEADER];
  const data = summary.rows.map((r) => [
    r.name,
    r.volume,
    String(r.qty),
    String(r.revenue),
    String(r.cost),
    String(r.margin),
  ]);
  const spacer = Array<string>(WIDTH).fill("");
  const footer = [
    metricRow("과세매출", COL.revenue, summary.taxableGross),
    metricRow("면세매출", COL.revenue, summary.taxFreeGross),
    metricRow("공급가액(과세)", COL.revenue, summary.supply),
    metricRow("부가세(10%)", COL.revenue, summary.vat),
    metricRow("총매출", COL.revenue, summary.revenue),
    metricRow("총원가", COL.cost, summary.totalCost),
    metricRow("총마진", COL.margin, summary.margin),
  ];
  return [header, ...data, spacer, ...footer];
}
