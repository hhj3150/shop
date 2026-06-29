import { getSupabase } from "./supabase";
import { SUB_DAY_CAP, SUB_PERIODS, type SubPeriod } from "./products";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";
import {
  buildRawBlocks,
  type OrderRow as BlockOrderRow,
  type OrderItemRow as BlockOrderItemRow,
} from "./slot-blocks";
import {
  normalizeBlocks,
  totalWeeks as blockTotalWeeks,
  activeBlockForRound,
  type RawBlock,
} from "./subscription-timeline";

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
  firstShipDate: string | null; // 첫배송 공휴일 보정일(없으면 1회차 = startedAt)
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  // '이번 주 건너뛰기' 자동재개 예정일(set 이면 1주 건너뛰는 중, null 이면 일반 상태/일시정지).
  skipResumeOn: string | null;
  totalWeeks: number;
  periodMonths: number;
  orderNo: string | null;
  totalAmount: number;
  deliveryMethod: string;
  // 원주문 + 입금확인류 연장주문을 created_at,id 순으로 조립한 블록 체인.
  // 블록별 환불 미리보기(refundAmount)와 활성 블록 산출에 쓰인다.
  blocks: RawBlock[];
};

type SlotJoinRow = {
  id: number;
  delivery_day: DeliveryDay;
  status: string;
  started_at: string | null;
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  skip_resume_on: string | null;
  extended_weeks: number | null;
  orders: {
    block_weeks: number | null;
    period_months: number | null;
    order_no: string | null;
    total_amount: number | null;
    delivery_method: string | null;
  } | null;
};

// 입금확인된 연장주문 금액 원자료(슬롯별 합산용).
type ExtAmountRow = {
  renews_slot_id: number | null;
  total_amount: number | null;
};

// 슬롯별 블록 조립용 원자료 — 원주문 1건 + 연장주문 N건 + 주문별 order_items.
// buildRawBlocks 에 그대로 넘겨 RawBlock[] 를 만든다.
export type SlotBlockSource = {
  slotId: number;
  originalOrder: BlockOrderRow;
  renewalOrders: BlockOrderRow[];
  itemsByOrder: Map<string, BlockOrderItemRow[]>;
};

function blocksForSlot(
  slotId: number,
  sources: readonly SlotBlockSource[]
): RawBlock[] {
  const src = sources.find((s) => s.slotId === slotId);
  if (!src) return [];
  return buildRawBlocks(src.originalOrder, src.renewalOrders, src.itemsByOrder);
}

// 슬롯 원자료 + '입금확인' 연장주문 금액을 합쳐 미리보기용 구독 모델을 만든다.
//   totalWeeks   = 원주문 block_weeks + 연장 누적 회차(extended_weeks)
//   totalAmount  = 원주문 total_amount + Σ(해당 슬롯 입금확인 연장주문 total_amount)
// 서버(cancel_subscription)의 환불 산식과 동일한 분자·분모를 갖도록 맞춘다.
export function toMySubscriptions(
  rows: SlotJoinRow[],
  extRows: ExtAmountRow[],
  blockSources: readonly SlotBlockSource[] = []
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
    firstShipDate: row.first_ship_date,
    paused: row.paused,
    pausedAt: row.paused_at,
    pausedDays: row.paused_days,
    skipResumeOn: row.skip_resume_on,
    // 총 배송 회차 = 원 주문 block_weeks + 연장 누적 회차
    totalWeeks: (row.orders?.block_weeks ?? 0) + (row.extended_weeks ?? 0),
    periodMonths: row.orders?.period_months ?? 1,
    orderNo: row.orders?.order_no ?? null,
    // 총 납입액 = 원 주문 + 입금확인된 연장주문 합계
    totalAmount: (row.orders?.total_amount ?? 0) + (extBySlot[row.id] ?? 0),
    deliveryMethod: row.orders?.delivery_method ?? "택배",
    // 블록 체인(원주문 먼저, 연장 created_at,id 순) — buildRawBlocks 로 조립.
    blocks: blocksForSlot(row.id, blockSources),
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
      "id, order_id, delivery_day, status, started_at, first_ship_date, paused, paused_at, paused_days, skip_resume_on, extended_weeks, orders(block_weeks, period_months, order_no, total_amount, delivery_method)"
    )
    .eq("user_id", uid)
    .neq("status", "해지")
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);

  const slotRows = (data ?? []) as unknown as (SlotJoinRow & {
    order_id: string | null;
  })[];

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

  const blockSources = await loadBlockSources(slotRows);

  return toMySubscriptions(
    slotRows as unknown as SlotJoinRow[],
    (extData ?? []) as ExtAmountRow[],
    blockSources
  );
}

// 블록 환불 미리보기에 쓰일 확정 블록 상태 — 서버 cancel_subscription 의 CONFIRMED 와 동일.
// 입금대기·취소 연장주문은 회차에 반영되지 않으므로 블록에서 제외한다.
const CONFIRMED_RENEWAL_STATUSES = [
  "입금확인",
  "배송준비",
  "배송중",
  "배송완료",
] as const;

// 주문 임베드 행(원주문/연장주문 공통) — 자기 order_items 포함.
type OrderWithItemsRow = {
  id: string;
  created_at: string;
  block_weeks: number | null;
  shipping_fee: number | null;
  renews_slot_id: number | null;
  order_items:
    | {
        delivery_day: DeliveryDay;
        qty: number;
        unit_price: number;
        product_name: string;
        volume: string;
      }[]
    | null;
};

function toBlockOrderRow(row: OrderWithItemsRow): BlockOrderRow {
  return {
    id: row.id,
    block_weeks: row.block_weeks ?? 0,
    shipping_fee: row.shipping_fee ?? 0,
    created_at: row.created_at,
  };
}

// 슬롯별 블록 조립용 원자료 로드 — 원주문 + 확정 연장주문 + 각자 order_items.
// 원주문(slot.order_id)과 연장주문(renews_slot_id) 각각을 자기 order_items 와 함께 임베드 조회한다.
async function loadBlockSources(
  slotRows: { id: number; order_id: string | null }[]
): Promise<SlotBlockSource[]> {
  const sb = getSupabase();
  const originalIds = slotRows
    .map((s) => s.order_id)
    .filter((id): id is string => id != null);
  const slotIds = slotRows.map((s) => s.id);
  if (slotIds.length === 0) return [];

  const ITEM_COLS =
    "order_items(delivery_day, qty, unit_price, product_name, volume)";

  // 원주문(items 임베드). order_id 가 없는 슬롯은 제외.
  const { data: origData, error: origError } =
    originalIds.length === 0
      ? { data: [], error: null }
      : await sb
          .from("orders")
          .select(`id, created_at, block_weeks, shipping_fee, renews_slot_id, ${ITEM_COLS}`)
          .in("id", originalIds);
  if (origError) throw new Error(origError.message);

  // 확정 연장주문(items 임베드).
  const { data: renewData, error: renewError } = await sb
    .from("orders")
    .select(`id, created_at, block_weeks, shipping_fee, renews_slot_id, ${ITEM_COLS}`)
    .in("renews_slot_id", slotIds)
    .in("status", CONFIRMED_RENEWAL_STATUSES as unknown as string[]);
  if (renewError) throw new Error(renewError.message);

  const origByOrderId = new Map<string, OrderWithItemsRow>();
  for (const row of (origData ?? []) as unknown as OrderWithItemsRow[]) {
    origByOrderId.set(row.id, row);
  }

  const renewsBySlot = new Map<number, OrderWithItemsRow[]>();
  for (const row of (renewData ?? []) as unknown as OrderWithItemsRow[]) {
    if (row.renews_slot_id == null) continue;
    const list = renewsBySlot.get(row.renews_slot_id) ?? [];
    renewsBySlot.set(row.renews_slot_id, [...list, row]);
  }

  return slotRows.flatMap((slot) => {
    if (slot.order_id == null) return [];
    const orig = origByOrderId.get(slot.order_id);
    if (orig == null) return [];
    const renewals = renewsBySlot.get(slot.id) ?? [];

    const itemsByOrder = new Map<string, BlockOrderItemRow[]>();
    for (const row of [orig, ...renewals]) {
      itemsByOrder.set(row.id, (row.order_items ?? []) as BlockOrderItemRow[]);
    }

    return [
      {
        slotId: slot.id,
        originalOrder: toBlockOrderRow(orig),
        renewalOrders: renewals.map(toBlockOrderRow),
        itemsByOrder,
      },
    ];
  });
}

// 남은(미배송) 회차 환불액 — 블록별 회당 단가 합산.
// 블록 데이터(sub.blocks)가 있으면 마지막 `remainingDeliveries` 회차가 속한 블록의
// (회당 상품합 + 회당 배송비)를 회차별로 합산한다(refundByBlocks 와 동일 알고리즘).
// 단일 블록·연장 없음이면 모든 회차 단가가 같아 기존 평균식과 동일한 결과가 된다.
// 블록 데이터가 없으면(레거시/미로드) 기존 평균식으로 안전하게 폴백한다.
// 주의: 이 함수는 화면 미리보기 전용이다. 실제 환불액은 서버(cancel_subscription RPC)가
//      동일한 공식으로 재계산하며, 클라이언트 값은 신뢰하지 않는다(C2).
export function refundAmount(sub: MySubscription, remainingDeliveries: number): number {
  const remaining = Math.max(0, remainingDeliveries);
  if (remaining <= 0) return 0;

  if (sub.blocks.length > 0) {
    const resolved = normalizeBlocks(sub.blocks);
    const total = blockTotalWeeks(sub.blocks);
    const firstRefundRound = Math.max(1, total - remaining + 1);
    let refund = 0;
    for (let round = firstRefundRound; round <= total; round++) {
      const b = activeBlockForRound(resolved, round);
      if (!b) continue;
      const perDelivery =
        b.items.reduce((s, it) => s + it.unitPrice * it.qty, 0) + b.shippingPerWeek;
      refund += perDelivery;
    }
    return refund;
  }

  if (sub.totalWeeks <= 0) return 0;
  const perDelivery = Math.round(sub.totalAmount / sub.totalWeeks);
  return perDelivery * remaining;
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

// 이번 주(다음 배송 1회) 건너뛰기. skipDate = 건너뛸 다음 배송 예정일(computeSchedule 의 nextDate).
//   서버가 그 날짜+1에 자동재개(7일 적립)하도록 예약 → 총 회차 보존, 종료일만 +7.
export async function skipNextDelivery(slotId: number, skipDate: string): Promise<void> {
  const { error } = await getSupabase().rpc("skip_next_delivery", {
    p_slot_id: slotId,
    p_skip_date: skipDate,
  });
  if (error) throw new Error(error.message);
}

// 건너뛰기 되돌리기(건너뛸 배송일 전에만). 적립 없이 원상복구.
export async function cancelSkip(slotId: number): Promise<void> {
  const { error } = await getSupabase().rpc("cancel_skip", { p_slot_id: slotId });
  if (error) throw new Error(error.message);
}

// '이번 주 건너뛰기' 가능 여부(순수 함수, 테스트 대상). UI 버튼 노출 판정의 단일 출처.
//   조건: 활성·시작됨·정지 아님·이미 건너뛰는 중 아님·다음 배송일이 존재(미래).
export function canSkipThisWeek(
  sub: Pick<MySubscription, "status" | "paused" | "skipResumeOn">,
  nextDate: string | null
): boolean {
  return (
    sub.status === "활성" &&
    !sub.paused &&
    !sub.skipResumeOn &&
    nextDate != null
  );
}
