// 생산 수요 집계 — 배송 명단(roster) 엔트리를 정기/단품별 제품 수량으로 분리.
//   roster(buildRosterForDate)가 이미 해지·회차소진·정지를 제외하므로, 여기서 집계하면
//   생산 계획이 실제 배송 명단과 100% 정합한다(matrix 기반 과다집계 제거).
//   설계: docs/superpowers/specs/2026-06-08-production-demand-split-design.md
import type { DeliveryEntry } from "./delivery-roster";
import type { DeliveryDay } from "./cart";
import { activeBlockForDate, type RawBlock } from "./subscription-timeline";

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

// ─── 주간 필요수량 매트릭스 (활성 블록 게이팅) ────────────────────────────────
//   요일별·제품별 1회(매주) 발송 수량. 슬롯 한 건이 연장으로 여러 블록(자기 order_items)을
//   가질 때, 그 주의 '활성 블록' 1개만 그 블록 요일 칸에 계상해 이중계상을 막는다.
//   레거시(단일 블록, 활성 구간 내) 슬롯은 기존 매트릭스와 동일.

// 매트릭스 집계에 필요한 슬롯 최소 입력(블록 체인 포함).
export type MatrixSlotInput = {
  startedAt: string | null;
  status: string;
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  blocks: RawBlock[];
};

const WEEKDAYS: readonly DeliveryDay[] = ["mon", "tue", "wed", "thu", "fri"];

function blockProductKey(it: { productName: string; volume: string }): string {
  return `${it.productName} ${it.volume}`;
}

/**
 * 이번 주(weekDates) 기준 요일별·제품별 필요수량 매트릭스.
 *
 * - weekDates: 이번 주 각 요일의 실제 날짜(YYYY-MM-DD). 활성 블록 판정에 쓴다.
 * - 슬롯마다 그 주의 활성 블록(activeBlockForDate)을 구하고, 활성 블록의 요일 칸에 1회 계상.
 *   주중(월~금) 4일 범위에선 회차가 동일하므로 활성 블록도 동일 → 정확히 한 번 계상된다.
 * - 해지·정지·소진·시작전 슬롯은 활성 블록이 없어 자연히 제외된다(roster 와 동일 SSOT).
 * - 단품은 애초에 슬롯/블록이 없으므로 입력에 포함되지 않는다(단품 제외 가드).
 */
export function buildWeeklyMatrix(
  slots: readonly MatrixSlotInput[],
  productKeys: readonly string[],
  weekDates: Record<DeliveryDay, string>
): Record<string, Record<DeliveryDay, number>> {
  const matrix: Record<string, Record<DeliveryDay, number>> = {};
  for (const key of productKeys) {
    matrix[key] = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
  }

  for (const slot of slots) {
    if (slot.status === "해지" || slot.paused) continue;
    if (slot.blocks.length === 0) continue;
    const input = {
      startedAt: slot.startedAt,
      paused: slot.paused,
      pausedAt: slot.pausedAt,
      pausedDays: slot.pausedDays,
      blocks: slot.blocks,
    };
    // 활성 블록의 요일 칸에만 1회 계상. 주중 요일마다 평가하되, 활성 블록의 요일과 일치하는
    //   요일에서만 더해 중복을 막는다.
    for (const wd of WEEKDAYS) {
      const active = activeBlockForDate(input, weekDates[wd]);
      if (!active || active.deliveryDay !== wd) continue;
      for (const it of active.items) {
        const key = blockProductKey(it);
        if (matrix[key]) matrix[key][wd] += it.qty;
      }
    }
  }

  return matrix;
}
