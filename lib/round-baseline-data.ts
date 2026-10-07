// 회차 확정 기준점 — 조회·쓰기 접근. 판단 로직은 lib/round-baseline(순수)에 둔다.
//
//   쓰기는 security definer RPC(admin_confirm_slot_rounds) 한 곳만 지난다.
//   화면에서 subscription_slots 를 직접 update 하지 않는다 — 관리자 확인·상한 검사·
//   order_events 기록이 전부 그 함수 안에 있어서, 우회하면 그게 통째로 빠진다.
import { getSupabase } from "@/lib/supabase";
import type { BaselineRow } from "@/lib/round-baseline";
import { sortBaselineRows } from "@/lib/round-baseline";

// RPC 가 돌려주는 날것의 한 행(snake_case).
type RawRow = {
  slot_id: number;
  name: string | null;
  phone: string | null;
  delivery_day: string | null;
  started_at: string | null;
  paused: boolean | null;
  paid_rounds: number | null;
  recorded_count: number | null;
  calendar_rounds: number | null;
  last_ship_date: string | null;
  confirmed_count: number | null;
  confirmed_at: string | null;
  confirmed_note: string | null;
};

// 활성 구독 전체의 확정 현황.
export async function loadBaselineRows(): Promise<BaselineRow[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("admin_round_baseline_rows");
    if (error) throw error;
    const rows = ((data as RawRow[]) ?? []).map((r) => ({
      slotId: Number(r.slot_id),
      name: r.name ?? "",
      phone: r.phone ?? "",
      deliveryDay: r.delivery_day ?? "",
      startedAt: r.started_at,
      paused: r.paused === true,
      paidRounds: Number(r.paid_rounds ?? 0),
      recordedCount: Number(r.recorded_count ?? 0),
      calendarRounds: Number(r.calendar_rounds ?? 0),
      lastShipDate: r.last_ship_date,
      confirmedCount: r.confirmed_count == null ? null : Number(r.confirmed_count),
      confirmedAt: r.confirmed_at,
      confirmedNote: r.confirmed_note,
    }));
    return sortBaselineRows(rows);
  } catch (error) {
    console.error("회차 확정 현황 조회 실패:", error);
    throw new Error("회차 확정 현황을 불러오지 못했습니다.");
  }
}

// 한 구독의 '지금까지 나간 회차'를 확정한다.
//   실패 사유를 그대로 올려 보낸다 — '결제 회차보다 많다' 같은 서버 거부는 사장님이
//   읽고 고쳐야 할 내용이지, 콘솔에만 남기고 삼킬 내용이 아니다.
export async function confirmSlotRounds(
  slotId: number,
  count: number,
  note?: string
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.rpc("admin_confirm_slot_rounds", {
    p_slot_id: slotId,
    p_count: count,
    p_note: note?.trim() ? note.trim() : null,
  });
  if (error) throw new Error(error.message);
}
