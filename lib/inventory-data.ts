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
      .select("id, product_id, delta, kind, ref_order_id, note, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as StockMovement[]) ?? [];
  } catch (error) {
    console.error("재고 원장 이력 조회 실패:", error);
    throw new Error("재고 이력을 불러오지 못했습니다.");
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

// 관리자 수동 거래(입고/조정/폐기). 성공 시 변동 후 현재고 반환.
export async function stockAdjust(
  productId: string,
  delta: number,
  kind: MovementKind,
  note?: string
): Promise<number> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_adjust", {
      p_product_id: productId,
      p_delta: delta,
      p_kind: kind,
      p_note: note ?? null,
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
