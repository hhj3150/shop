// 재고 원장 데이터 접근 — 관리자 ERP 용. 쓰기는 전부 security definer RPC 경유.
//   조회: 재고 현황(product_catalog) · 원장 이력(stock_movements) · 출고 이력(shipment_log).
import { getSupabase } from "@/lib/supabase";
import type { MovementKind } from "@/lib/inventory";

// 재고 현황 1행(현재고·안전재고 포함). product_catalog 의 재고 관점 뷰.
export type InventoryRow = {
  id: string;
  name: string;
  volume: string;
  stock: number | null;
  safety_stock: number | null;
  active: boolean;
};

// 원장 이력 1건.
export type StockMovement = {
  id: string;
  product_id: string;
  delta: number;
  kind: MovementKind;
  ref_order_id: string | null;
  note: string | null;
  expiry_date: string | null; // 입고 행만 값, 그 외 null
  created_at: string;
};

// 재고 현황 전체(id 순).
export async function loadInventory(): Promise<InventoryRow[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("product_catalog")
      .select("id, name, volume, stock, safety_stock, active")
      .order("id");
    if (error) throw error;
    return (data as InventoryRow[]) ?? [];
  } catch (error) {
    console.error("재고 현황 조회 실패:", error);
    throw new Error("재고 현황을 불러오지 못했습니다.");
  }
}

// 최근 원장 이력(기본 50건).
export async function loadMovements(limit = 50): Promise<StockMovement[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("stock_movements")
      .select("id, product_id, delta, kind, ref_order_id, note, expiry_date, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as StockMovement[]) ?? [];
  } catch (error) {
    console.error("재고 원장 이력 조회 실패:", error);
    throw new Error("재고 이력을 불러오지 못했습니다.");
  }
}

// 제품별 유통기한 목록(경보용). 입고 행 중 유통기한이 막 지난 것(−7일)부터 미래까지.
//   필터는 expiry_date 기준(created_at 아님) — 유통기한 긴 품목의 임박분을 놓치지 않기 위함.
//   하한 −7일은 막 지난 만료까지 잡되 옛 데이터 노이즈는 차단(컷오프는 UTC 근사, 경보 판정은 KST daysUntil).
export async function loadExpiries(): Promise<Map<string, string[]>> {
  try {
    const sb = getSupabase();
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceISO = since.toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("stock_movements")
      .select("product_id, expiry_date")
      .eq("kind", "입고")
      .not("expiry_date", "is", null)
      .gte("expiry_date", sinceISO);
    if (error) throw error;
    const map = new Map<string, string[]>();
    for (const r of data ?? []) {
      const arr = map.get(r.product_id) ?? [];
      arr.push(r.expiry_date as string);
      map.set(r.product_id, arr);
    }
    return map;
  } catch (error) {
    console.error("유통기한 조회 실패:", error);
    throw new Error("유통기한 정보를 불러오지 못했습니다.");
  }
}

// 이미 출고된 (order_id, ship_date) 키 집합 — DispatchPanel 버튼 비활성용.
//   키 형식: `${order_id}|${ship_date}`.
export async function loadShippedKeys(): Promise<Set<string>> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("shipment_log")
      .select("order_id, ship_date");
    if (error) throw error;
    return new Set(
      (data ?? []).map((r) => `${r.order_id}|${r.ship_date}`)
    );
  } catch (error) {
    console.error("출고 이력 조회 실패:", error);
    throw new Error("출고 이력을 불러오지 못했습니다.");
  }
}

// 이미 배송완료(도착확인)된 (order_id, ship_date) 키 집합 — DispatchPanel 도착확인 표시용.
//   delivered_at 이 채워진 회차만. 키 형식: `${order_id}|${ship_date}`.
export async function loadDeliveredKeys(): Promise<Set<string>> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("shipment_log")
      .select("order_id, ship_date")
      .not("delivered_at", "is", null);
    if (error) throw error;
    return new Set(
      (data ?? []).map((r) => `${r.order_id}|${r.ship_date}`)
    );
  } catch (error) {
    console.error("배송완료 이력 조회 실패:", error);
    throw new Error("배송완료 이력을 불러오지 못했습니다.");
  }
}

// 배송 통계용 회차 행 — 발송일(ship_date) 기간 내 shipment_log 의 출고/도착/택배사.
//   computeDeliveryStats 의 입력. 관리자만(RLS is_admin) 전체 조회.
export async function loadShipmentStatRows(
  fromISO: string,
  toISO: string
): Promise<{ shipped_at: string | null; delivered_at: string | null; courier: string | null }[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("shipment_log")
      .select("shipped_at, delivered_at, courier")
      .gte("ship_date", fromISO)
      .lte("ship_date", toISO);
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("배송 통계 조회 실패:", error);
    throw new Error("배송 통계를 불러오지 못했습니다.");
  }
}

// 관리자 수동 거래(입고/조정/폐기). 성공 시 변동 후 현재고 반환.
export async function stockAdjust(
  productId: string,
  delta: number,
  kind: MovementKind,
  note?: string,
  expiry?: string
): Promise<number> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_adjust", {
      p_product_id: productId,
      p_delta: delta,
      p_kind: kind,
      p_note: note ?? null,
      p_expiry: expiry ?? null,
    });
    if (error) throw error;
    return (data as { stock: number }).stock;
  } catch (error) {
    console.error("재고 조정 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "재고 조정에 실패했습니다."
    );
  }
}

// 배송 출고 확정 → 자동 차감. 'shipped'(차감함) | 'already'(이미 출고) 반환.
export async function stockShipOut(
  orderId: string,
  shipDate: string
): Promise<"shipped" | "already"> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_ship_out", {
      p_order_id: orderId,
      p_ship_date: shipDate,
    });
    if (error) throw error;
    return (data as { status: "shipped" | "already" }).status;
  } catch (error) {
    console.error("출고 처리 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "출고 처리에 실패했습니다."
    );
  }
}

// 회차별 배송 송장 기록 — 출고로 만들어진 그 회차(주문|발송일) 행에 택배사·송장을 채운다.
//   best-effort: 마이그레이션 미적용 등으로 실패해도 출고/주문 갱신 흐름을 막지 않는다.
//   (orders 단일 컬럼은 호출자가 별도로 갱신 — 레거시 표시·알림 호환)
export async function recordShipmentTracking(
  orderId: string,
  shipDate: string,
  courier: string,
  trackingNo: string
): Promise<boolean> {
  try {
    const sb = getSupabase();
    const { error } = await sb.rpc("record_shipment_tracking", {
      p_order_id: orderId,
      p_ship_date: shipDate,
      p_courier: courier,
      p_tracking_no: trackingNo,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("회차 송장 기록 실패:", error);
    return false;
  }
}

// 회차별 배송완료 표시 — 그 회차 행에 delivered_at 기록. best-effort.
export async function markShipmentDelivered(
  orderId: string,
  shipDate: string
): Promise<boolean> {
  try {
    const sb = getSupabase();
    const { error } = await sb.rpc("mark_shipment_delivered", {
      p_order_id: orderId,
      p_ship_date: shipDate,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("회차 배송완료 표시 실패:", error);
    return false;
  }
}
