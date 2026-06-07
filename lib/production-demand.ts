// 생산 수요 집계 — 배송 명단(roster) 엔트리를 정기/단품별 제품 수량으로 분리.
//   roster(buildRosterForDate)가 이미 해지·회차소진·정지를 제외하므로, 여기서 집계하면
//   생산 계획이 실제 배송 명단과 100% 정합한다(matrix 기반 과다집계 제거).
//   설계: docs/superpowers/specs/2026-06-08-production-demand-split-design.md
import type { DeliveryEntry } from "./delivery-roster";

// 집계에 필요한 품목 최소 필드.
type DemandItem = { product_name: string; volume: string; qty: number };

// 제품키 → 수량.
export type DemandMap = Record<string, number>;

// "제품명 용량" 단일 키.
function productKey(it: DemandItem): string {
  return `${it.product_name} ${it.volume}`;
}

// roster 엔트리들을 kind별·제품키별 수량으로 분리.
//   정기/단품은 서로 독립 집계(같은 제품이 양쪽에 있어도 분리).
export function splitDemandByKind<O, I extends DemandItem>(
  entries: readonly DeliveryEntry<O, I>[]
): { 정기: DemandMap; 단품: DemandMap } {
  const 정기: DemandMap = {};
  const 단품: DemandMap = {};
  for (const e of entries) {
    const target = e.kind === "정기" ? 정기 : 단품;
    for (const it of e.items) {
      const key = productKey(it);
      target[key] = (target[key] ?? 0) + it.qty;
    }
  }
  return { 정기, 단품 };
}
