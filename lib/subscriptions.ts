import { getSupabase } from "./supabase";
import { SUB_DAY_CAP, SUB_PERIODS, type SubPeriod } from "./products";
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

// 다섯 요일 잔여 좌석 합계. 각 요일 remaining()은 max(0, capacity - taken)으로 이미 클램프됨.
// 잔여 표시의 단일 진실 공급원 — SlotAvailability·MembershipCounter가 공유한다.
export function totalRemainingSeats(counts: DayCounts): number {
  return DELIVERY_DAYS.reduce((sum, d) => sum + remaining(counts[d]), 0);
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

// 입금확인된 연장주문 금액 원자료(슬롯별 합산용).
type ExtAmountRow = {
  renews_slot_id: number | null;
  total_amount: number | null;
};

// 슬롯 원자료 + '입금확인' 연장주문 금액을 합쳐 미리보기용 구독 모델을 만든다.
//   totalWeeks   = 원주문 block_weeks + 연장 누적 회차(extended_weeks)
//   totalAmount  = 원주문 total_amount + Σ(해당 슬롯 입금확인 연장주문 total_amount)
// 서버(cancel_subscription)의 환불 산식과 동일한 분자·분모를 갖도록 맞춘다.
export function toMySubscriptions(
  rows: SlotJoinRow[],
  extRows: ExtAmountRow[]
): MySubscription[] {
  const extBySlot = extRows.reduce<Record<number, number>>((acc, r) => {
    if (r.renews_slot_id == null) return acc;
    return {
      ...acc,
      [r.renews_slot_id]: (acc[r.renews_slot_id] ?? 0) + (r.total_amount ?? 0),
    };
  }, {});

  return rows.map((row) => ({
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
    // 총 납입액 = 원 주문 + 입금확인된 연장주문 합계
    totalAmount: (row.orders?.total_amount ?? 0) + (extBySlot[row.id] ?? 0),
  }));
}

// 로그인한 회원의 구독 슬롯 목록(해지 제외). 스케줄·환불 계산용 원자료를 그대로 돌려준다.
export async function getMySubscriptions(): Promise<MySubscription[]> {
  const sb = getSupabase();
  // 본인 것만 — 관리자 계정은 RLS상 전체 조회가 가능하므로 user_id 를 반드시 명시한다.
  const {
    data: { session },
  } = await sb.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return [];
  const { data, error } = await sb
    .from("subscription_slots")
    .select(
      "id, delivery_day, status, started_at, paused, paused_at, paused_days, extended_weeks, orders(block_weeks, period_months, order_no, total_amount)"
    )
    .eq("user_id", uid)
    .neq("status", "해지")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  // 입금확인된 연장주문 금액(슬롯별)을 함께 가져와 총 납입액에 합산한다.
  // extended_weeks 는 연장주문 입금확인 시에만 누적되므로 status='입금확인' 만 합산해야
  // 회차와 금액이 정확히 대응한다(미입금 연장은 회차·금액 모두 제외).
  const { data: extData, error: extError } = await sb
    .from("orders")
    .select("renews_slot_id, total_amount")
    .eq("user_id", uid)
    .eq("status", "입금확인")
    .not("renews_slot_id", "is", null);
  if (extError) throw new Error(extError.message);

  return toMySubscriptions(
    (data ?? []) as unknown as SlotJoinRow[],
    (extData ?? []) as ExtAmountRow[]
  );
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

export type RenewalItem = { product_id: string; qty: number };
export type RenewalArgs = {
  items: RenewalItem[];
  period: SubPeriod;
  deliveryDay: DeliveryDay;
};

// 연장 신청 입력 검증(UX 용). 권위 재검증은 SQL request_renewal 이 수행하므로,
// 여기서는 잘못된 입력으로 인한 무의미한 네트워크 호출을 막는 것이 목적이다.
// zod 는 이 프로젝트의 런타임 의존성이 아니므로 손수 검증한다.
export function validateRenewalArgs(args: RenewalArgs): void {
  if (!Array.isArray(args.items) || args.items.length === 0) {
    throw new Error("연장할 품목이 없습니다.");
  }
  for (const it of args.items) {
    if (!it.product_id || !Number.isInteger(it.qty) || it.qty <= 0) {
      throw new Error("품목/수량이 올바르지 않습니다.");
    }
  }
  if (!SUB_PERIODS.includes(args.period)) {
    throw new Error("구독 기간이 올바르지 않습니다.");
  }
  if (!DELIVERY_DAYS.includes(args.deliveryDay)) {
    throw new Error("배송 요일이 올바르지 않습니다.");
  }
}

// 활성 구독을 연장 신청(구성·요일·회차 변경 가능). 서버가 입력 품목으로 할인 재계산해
// 입금대기 연장 주문 + 자기 order_items 를 만들고, 주문번호·금액을 돌려준다(입금 안내용).
export async function requestRenewal(
  slotId: number,
  args: RenewalArgs
): Promise<RenewalResult> {
  validateRenewalArgs(args);
  const { data, error } = await getSupabase().rpc("request_renewal", {
    p_slot_id: slotId,
    p_items: args.items,
    p_period: args.period,
    p_delivery_day: args.deliveryDay,
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
