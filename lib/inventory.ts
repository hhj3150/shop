// 재고 원장 순수 로직 — 부족 판정·차감 계산. DB·supabase 의존 없음(테스트 가능).
//   권위값은 product_catalog.stock(현재고), 변동 이력은 stock_movements(원장).
//   여기서는 SQL RPC 가 강제하는 불변식(음수 차단·무제한 통과)을 TS 로도 동일하게 둔다.

// 원장 거래 유형. SQL check 제약(stock_movements.kind)과 1:1 일치해야 한다.
export const MOVEMENT_KINDS = ["입고", "출고", "조정", "폐기"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

// 안전재고 부족 판정. 현재고·안전재고가 모두 숫자이고 현재고 ≤ 안전재고면 부족.
//   현재고 NULL(무제한) 또는 안전재고 NULL(경보 안 함)이면 부족 아님.
export function isLowStock(
  stock: number | null,
  safetyStock: number | null
): boolean {
  if (stock === null || safetyStock === null) return false;
  return stock <= safetyStock;
}

// 변동 후 현재고. current=null(무제한)이면 변동을 무시하고 null(차감 스킵)을 반환.
//   결과가 0 미만이면 차단(스펙: 0 미만 금지). delta 는 +입고/조정, −출고/폐기.
export function nextStock(current: number | null, delta: number): number | null {
  if (current === null) return null;
  const result = current + delta;
  if (result < 0) {
    throw new RangeError("재고 부족: 차감 후 수량이 0 미만이 됩니다.");
  }
  return result;
}
