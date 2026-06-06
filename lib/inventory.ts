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

// ── 유통기한(모듈 ②) ──────────────────────────────────────────

// 유통기한('YYYY-MM-DD', KST)까지 남은 KST 달력일. 오늘=0, 내일=+1, 지남=음수.
//   renewal-retention.ts 의 kstDaysUntil 과 동일 방식(UTC+9, Date.UTC 에폭 차) — UTC 실행 off-by-one 방지.
export function daysUntil(expiry: string, today: Date): number {
  const [y, m, d] = expiry.split("-").map(Number);
  const expiryEpoch = Date.UTC(y, m - 1, d);
  const k = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayEpoch = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return Math.round((expiryEpoch - todayEpoch) / 86_400_000);
}

export type ExpiryStatus = "expired" | "warning" | "ok" | "none";
export type ExpiryAlert = { status: ExpiryStatus; nearest: string | null; days: number | null };

// 제품의 유통기한 목록 → 경보 상태. 미래분이 있으면 가장 임박한 것 기준(D-warnDays 이내=warning),
//   미래분이 없고 과거만 있으면 expired, 비면 none. (배치 잔량은 보지 않음 — 스펙 approach B.)
export function expiryAlert(
  expiries: string[],
  today: Date,
  warnDays = 3
): ExpiryAlert {
  if (expiries.length === 0) return { status: "none", nearest: null, days: null };
  const withDays = expiries.map((e) => ({ e, d: daysUntil(e, today) }));
  const upcoming = withDays.filter((x) => x.d >= 0).sort((a, b) => a.d - b.d);
  if (upcoming.length > 0) {
    const { e, d } = upcoming[0];
    return { status: d <= warnDays ? "warning" : "ok", nearest: e, days: d };
  }
  // 전부 과거 → 가장 최근 과거(=d 최댓값).
  const latestPast = [...withDays].sort((a, b) => b.d - a.d)[0];
  return { status: "expired", nearest: latestPast.e, days: latestPast.d };
}
