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
  totalAmount: number;
};

type SlotJoinRow = {
  id: number;
  delivery_day: DeliveryDay;
  status: string;
  started_at: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
  orders: {
    block_weeks: number | null;
    period_months: number | null;
    order_no: string | null;
    total_amount: number | null;
  } | null;
};

// 로그인한 회원의 구독 슬롯 목록(해지 제외). 스케줄 계산용 원자료를 그대로 돌려준다.
export async function getMySubscriptions(): Promise<MySubscription[]> {
  const { data, error } = await getSupabase()
    .from("subscription_slots")
    .select(
      "id, delivery_day, status, started_at, paused, paused_at, paused_days, extended_weeks, orders(block_weeks, period_months, order_no, total_amount)"
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
    // 총 배송 회차 = 원 주문 block_weeks + 연장 누적 회차
    totalWeeks: (row.orders?.block_weeks ?? 0) + (row.extended_weeks ?? 0),
    periodMonths: row.orders?.period_months ?? 1,
    orderNo: row.orders?.order_no ?? null,
    totalAmount: row.orders?.total_amount ?? 0,
  }));
}

// 남은(미배송) 회차 환불액 = round(총입금액 / 총회차) × 남은회차.
// 총입금액 = (회당 상품합계 + 회당 배송비) × 총회차 이므로, 회차당 단가에 배송비가 포함된다.
// 주의: 이 함수는 화면 미리보기 전용이다. 실제 환불액은 서버(cancel_subscription RPC)가
//      동일한 공식으로 재계산하며, 클라이언트 값은 신뢰하지 않는다(C2).
export function refundAmount(sub: MySubscription, remainingDeliveries: number): number {
  if (sub.totalWeeks <= 0) return 0;
  const perDelivery = Math.round(sub.totalAmount / sub.totalWeeks);
  return perDelivery * Math.max(0, remainingDeliveries);
}

// 구독 해지. 환불액은 서버가 재계산해 반환하므로(C2), 그 값을 그대로 돌려준다.
export async function cancelSubscription(
  slotId: number,
  reason: string,
  refundAccount: string
): Promise<number> {
  const { data, error } = await getSupabase().rpc("cancel_subscription", {
    p_slot_id: slotId,
    p_reason: reason,
    p_refund_account: refundAccount,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// 입금 전(입금대기) 주문을 회원이 스스로 취소. 환불 없음.
// 연결된 미시작 슬롯은 서버에서 '해지' 처리되어 선착순 자리가 반환된다.
export async function cancelUnpaidOrder(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc("cancel_unpaid_order", {
    p_order_id: orderId,
  });
  if (error) throw new Error(error.message);
}

export type RenewalResult = {
  orderId: string;
  orderNo: string;
  total: number;
};

// 활성 구독을 1개월(4회) 연장 신청. 서버가 원 주문 품목으로 7% 재계산해
// 입금대기 연장 주문을 만들고, 주문번호·금액을 돌려준다(입금 안내용).
export async function requestRenewal(slotId: number): Promise<RenewalResult> {
  const { data, error } = await getSupabase().rpc("request_renewal", {
    p_slot_id: slotId,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { order_id?: string; order_no?: string; total?: number };
  return {
    orderId: r.order_id ?? "",
    orderNo: r.order_no ?? "",
    total: r.total ?? 0,
  };
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
