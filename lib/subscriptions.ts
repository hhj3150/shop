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
