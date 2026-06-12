// 로젠 행 × 우리 배송큐 주문 매칭(순수). 휴대폰 앞7자리(필수) + 이름(정규화) 으로 확신도를 가른다.
//   안전: high(이름정확) 외엔 자동삽입 금지. 행↔주문 다대일/일대다 충돌은 ambiguous 로 격리.
import type { LogenRow } from "./logen-excel";
import { phone7 } from "./phone";

export type CandidateOrder = {
  id: string;
  order_no: string;
  ship_name: string;
  ship_phone: string;
  tracking_no: string | null;
};

export type Matched = { rowIdx: number; orderId: string; tracking: string; confidence: "high" | "review" };
export type AlreadyFilled = { rowIdx: number; orderId: string; tracking: string };
export type Ambiguous = { rowIdx: number; tracking: string; candidateOrderIds: string[] };
export type Unmatched = { rowIdx: number; tracking: string; recipientName: string; phone7: string };

export type LogenMatchResult = {
  matched: Matched[];
  alreadyFilled: AlreadyFilled[];
  ambiguous: Ambiguous[];
  unmatched: Unmatched[];
};

const TITLE_SUFFIXES = ["대표", "사장", "원장", "점장", "님", "씨", "귀하"];

export function normalizeName(raw: string): string {
  let s = (raw ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "");
  for (const t of TITLE_SUFFIXES) {
    if (s.length > t.length && s.endsWith(t)) { s = s.slice(0, -t.length); break; }
  }
  return s;
}

export function matchLogen(rows: LogenRow[], orders: CandidateOrder[]): LogenMatchResult {
  const byOrderNo = new Map<string, CandidateOrder[]>();
  const byPhone7 = new Map<string, CandidateOrder[]>();
  for (const o of orders) {
    byOrderNo.set(o.order_no, [...(byOrderNo.get(o.order_no) ?? []), o]);
    const p = phone7(o.ship_phone);
    if (p) byPhone7.set(p, [...(byPhone7.get(p) ?? []), o]);
  }

  type Cand = { rowIdx: number; row: LogenRow; orders: CandidateOrder[] };
  const cands: Cand[] = rows.map((row, rowIdx) => {
    const exact = row.orderNo ? byOrderNo.get(row.orderNo) : undefined;
    if (exact && exact.length > 0) return { rowIdx, row, orders: exact };
    const list = row.phone7 ? byPhone7.get(row.phone7) ?? [] : [];
    return { rowIdx, row, orders: list };
  });

  const result: LogenMatchResult = { matched: [], alreadyFilled: [], ambiguous: [], unmatched: [] };

  // 단일후보 행이 같은 주문을 다투면(일대다) 그 주문 점유 행 전부 ambiguous.
  const singleClaims = new Map<string, number[]>();
  for (const c of cands) {
    if (c.orders.length === 1) {
      const id = c.orders[0].id;
      singleClaims.set(id, [...(singleClaims.get(id) ?? []), c.rowIdx]);
    }
  }
  const contested = new Set<number>();
  for (const [, idxs] of singleClaims) {
    if (idxs.length > 1) idxs.forEach((i) => contested.add(i));
  }

  for (const c of cands) {
    const { rowIdx, row } = c;
    if (c.orders.length === 0) {
      result.unmatched.push({ rowIdx, tracking: row.tracking, recipientName: row.recipientName, phone7: row.phone7 });
      continue;
    }
    if (c.orders.length > 1 || contested.has(rowIdx)) {
      result.ambiguous.push({ rowIdx, tracking: row.tracking, candidateOrderIds: c.orders.map((o) => o.id) });
      continue;
    }
    const o = c.orders[0];
    if (o.tracking_no && o.tracking_no.trim()) {
      result.alreadyFilled.push({ rowIdx, orderId: o.id, tracking: row.tracking });
      continue;
    }
    const confidence = normalizeName(row.recipientName) === normalizeName(o.ship_name) ? "high" : "review";
    result.matched.push({ rowIdx, orderId: o.id, tracking: row.tracking, confidence });
  }
  return result;
}
