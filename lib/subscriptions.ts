import { getSupabase } from "./supabase";
import { SUB_DAY_CAP } from "./products";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";

export type DayCount = {
  active: number; // 자동이체 확인된 정회원
  taken: number; // 신청+활성 (정원 100 점유)
  waitlist: number; // 대기자 수
  capacity: number;
};
export type DayCounts = Record<DeliveryDay, DayCount>;

function emptyCounts(): DayCounts {
  return DELIVERY_DAYS.reduce((acc, d) => {
    acc[d] = { active: 0, taken: 0, waitlist: 0, capacity: SUB_DAY_CAP };
    return acc;
  }, {} as DayCounts);
}

// 요일별 점유 현황 조회. 미로그인 방문자도 잔여 수량을 볼 수 있다.
export async function getDayCounts(): Promise<DayCounts> {
  const counts = emptyCounts();
  try {
    const { data } = await getSupabase()
      .from("subscription_day_count")
      .select("delivery_day, active, taken, waitlist, capacity");
    for (const row of (data ?? []) as Array<{
      delivery_day: DeliveryDay;
      active: number;
      taken: number;
      waitlist: number;
      capacity: number;
    }>) {
      if (counts[row.delivery_day]) {
        counts[row.delivery_day] = {
          active: row.active,
          taken: row.taken,
          waitlist: row.waitlist,
          capacity: row.capacity,
        };
      }
    }
  } catch {
    // 환경변수 미설정 등 → 빈 카운트 반환
  }
  return counts;
}

export function remaining(count: DayCount): number {
  return Math.max(0, count.capacity - count.taken);
}

export function isWaitlisted(count: DayCount): boolean {
  return count.taken >= count.capacity;
}

export type MySubscription = {
  slotId: number;
  deliveryDay: DeliveryDay;
  status: string;
  startedAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  totalWeeks: number;
  periodMonths: number;
  orderNo: string | null;
};

type SlotJoinRow = {
  id: number;
  delivery_day: DeliveryDay;
  status: string;
  started_at: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  orders: {
    block_weeks: number | null;
    period_months: number | null;
    order_no: string | null;
  } | null;
};

// 로그인한 회원의 구독 슬롯 목록(해지 제외). 스케줄 계산용 원자료를 그대로 돌려준다.
export async function getMySubscriptions(): Promise<MySubscription[]> {
  const { data, error } = await getSupabase()
    .from("subscription_slots")
    .select(
      "id, delivery_day, status, started_at, paused, paused_at, paused_days, orders(block_weeks, period_months, order_no)"
    )
    .neq("status", "해지")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as SlotJoinRow[]).map((row) => ({
    slotId: row.id,
    deliveryDay: row.delivery_day,
    status: row.status,
    startedAt: row.started_at,
    paused: row.paused,
    pausedAt: row.paused_at,
    pausedDays: row.paused_days,
    totalWeeks: row.orders?.block_weeks ?? 0,
    periodMonths: row.orders?.period_months ?? 1,
    orderNo: row.orders?.order_no ?? null,
  }));
}

export async function pauseSubscription(slotId: number): Promise<void> {
  const { error } = await getSupabase().rpc("pause_subscription", {
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
}

export async function resumeSubscription(slotId: number): Promise<void> {
  const { error } = await getSupabase().rpc("resume_subscription", {
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
}
