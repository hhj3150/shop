// 배송일 변경 — Supabase I/O. 순수 규칙은 lib/shipment-reschedule.ts.
import { getSupabase } from "./supabase";
import type { ShipmentReschedule } from "./shipment-reschedule";

// 전체 변경 기록(관리자 RLS). 표가 아직 없거나 실패하면 빈 배열 — 명단은 그대로 떠야 한다.
export async function loadReschedules(): Promise<ShipmentReschedule[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("shipment_reschedules")
    .select("id, order_id, delivery_day, from_date, to_date, note")
    .order("to_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ShipmentReschedule[];
}

// 특정 주문들의 변경 기록(손님 RLS: 본인 주문분만 보인다).
export async function loadReschedulesForOrders(orderIds: readonly string[]): Promise<ShipmentReschedule[]> {
  if (orderIds.length === 0) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from("shipment_reschedules")
    .select("id, order_id, delivery_day, from_date, to_date, note")
    .in("order_id", [...orderIds]);
  if (error) throw error;
  return (data ?? []) as ShipmentReschedule[];
}

// 회차 1회 이동 등록(관리자 RPC). 같은 (주문·요일·예정일)이 이미 있으면 새 날짜로 덮어쓴다.
export async function rescheduleShipment(input: {
  orderId: string;
  deliveryDay: string;
  fromISO: string;
  toISO: string;
  note?: string | null;
}): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("admin_reschedule_shipment", {
    p_order_id: input.orderId,
    p_delivery_day: input.deliveryDay,
    p_from: input.fromISO,
    p_to: input.toISO,
    p_note: input.note ?? null,
  });
  if (error) throw error;
}

// 이동 취소(관리자 RPC). 옮긴 날짜로 이미 출고됐으면 서버가 거부한다.
export async function cancelReschedule(id: number): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("admin_cancel_reschedule", { p_id: id });
  if (error) throw error;
}
