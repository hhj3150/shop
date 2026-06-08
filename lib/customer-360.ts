// 고객 한 명의 흩어진 원자료(주문·품목·구독슬롯·환불·프로필)를 360 드로어 표시용
//   뷰모델로 집계하는 순수 함수. React/Supabase 비의존 — 단위 테스트 대상.
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";

// ── 입력 타입(관리자 행 타입의 구조적 부분집합) ─────────────
export type C360Order = {
  id: string;
  user_id: string;
  order_no: string;
  status: string;
  order_type: string;
  block_weeks: number | null;
  total_amount: number;
  created_at: string;
  paid_at: string | null;
  pay_method: string | null;
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  cash_receipt_type: string | null;
  cash_receipt_issued: boolean | null;
};

export type C360Item = {
  order_id: string;
  product_name: string;
  volume: string;
  qty: number;
};

export type C360Slot = DispatchSlotInfo & {
  id: number;
  user_id: string;
  order_id: string | null;
  delivery_day: string;
  refund_amount: number | null;
  cancelled_at: string | null;
};

export type C360Return = {
  order_id: string;
  type: string;
  amount: number;
  created_at: string;
};

export type C360Profile = {
  name: string;
  phone: string;
  postcode: string | null;
  address: string | null;
  address_detail: string | null;
} | null;

export type C360Summary = {
  ltv: number;
  confirmedCount: number;
  aov: number;
  segment: string;
  recencyDays: number | null;
} | null;

export type C360Input = {
  userId: string;
  name: string; // 프로필 결손 시 폴백 이름
  orders: C360Order[];
  items: C360Item[];
  slots: C360Slot[];
  returns: C360Return[];
  profile: C360Profile;
  summary: C360Summary;
  todayISO: string;
};

// ── 출력 뷰모델 ───────────────────────────────
export type SubState = "활성" | "정지" | "완료" | "해지";

export type SubLine = {
  slotId: number;
  weekdayLabel: string;
  state: SubState;
  round: number;
  total: number;
  remaining: number;
  startedAt: string | null;
};

export type OrderCard = {
  id: string;
  orderNo: string;
  orderType: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  blockWeeks: number | null;
  items: { productName: string; volume: string; qty: number }[];
  deposit: { paidAt: string | null; payMethod: string | null } | null;
  tracking: { courier: string | null; trackingNo: string | null; shippedAt: string | null } | null;
  receipt: { type: string; issued: boolean } | null;
};

export type RefundLine = {
  source: "구독해지" | "환불접수";
  label: string;
  date: string | null;
  amount: number;
};

export type Customer360 = {
  header: { name: string; profile: C360Profile; summary: C360Summary };
  subscriptions: SubLine[];
  orders: OrderCard[];
  refunds: RefundLine[];
};

const WEEKDAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

function subState(slot: C360Slot, remaining: number): SubState {
  if (slot.status === "해지") return "해지";
  if (slot.paused) return "정지";
  if (remaining === 0) return "완료";
  return "활성";
}

export function buildCustomer360(input: C360Input): Customer360 {
  const { userId, name, orders, items, slots, returns, profile, summary, todayISO } = input;

  // 이 고객의 주문(최신순) + order_id 집합(품목·환불 소속 판정용).
  const myOrders = orders
    .filter((o) => o.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const myOrderIds = new Set(myOrders.map((o) => o.id));
  // 이 고객의 주문만으로 회차계산용 원주문 block_weeks 조회표를 만든다(타 user 누수 차단).
  const blockWeeksByOrder = new Map(myOrders.map((o) => [o.id, o.block_weeks ?? 0]));
  const orderNoById = new Map(myOrders.map((o) => [o.id, o.order_no]));

  // 주문별 품목.
  const itemsByOrder = new Map<string, { productName: string; volume: string; qty: number }[]>();
  for (const it of items) {
    if (!myOrderIds.has(it.order_id)) continue;
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push({ productName: it.product_name, volume: it.volume, qty: it.qty });
    itemsByOrder.set(it.order_id, arr);
  }

  const orderCards: OrderCard[] = myOrders.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    orderType: o.order_type,
    status: o.status,
    totalAmount: o.total_amount,
    createdAt: o.created_at,
    blockWeeks: o.block_weeks,
    items: itemsByOrder.get(o.id) ?? [],
    deposit: o.paid_at || o.pay_method ? { paidAt: o.paid_at, payMethod: o.pay_method } : null,
    tracking:
      o.courier || o.tracking_no || o.shipped_at
        ? { courier: o.courier, trackingNo: o.tracking_no, shippedAt: o.shipped_at }
        : null,
    receipt: o.cash_receipt_type
      ? { type: o.cash_receipt_type, issued: o.cash_receipt_issued === true }
      : null,
  }));

  // 구독 슬롯 — 원주문 block_weeks 로 회차 계산(슬롯엔 block_weeks 컬럼이 없다).
  const subscriptions: SubLine[] = slots
    .filter((s) => s.user_id === userId)
    .map((s) => {
      const blockWeeks = s.order_id ? blockWeeksByOrder.get(s.order_id) ?? 0 : 0;
      const { round, total, remaining } = dispatchScheduleForSlot(s, blockWeeks, todayISO);
      return {
        slotId: s.id,
        weekdayLabel: WEEKDAY_LABEL[s.delivery_day] ?? s.delivery_day,
        state: subState(s, remaining),
        round,
        total,
        remaining,
        startedAt: s.started_at,
      };
    });

  // 환불 합본: 구독 해지(refund_amount>0) + 환불접수(내 주문 소속). 출처가 달라 중복되지 않는다.
  const cancelRefunds: RefundLine[] = slots
    .filter((s) => s.user_id === userId && s.status === "해지" && (s.refund_amount ?? 0) > 0)
    .map((s) => ({
      source: "구독해지" as const,
      label: `${WEEKDAY_LABEL[s.delivery_day] ?? s.delivery_day}요일 구독 해지`,
      date: s.cancelled_at,
      amount: s.refund_amount ?? 0,
    }));
  const returnRefunds: RefundLine[] = returns
    .filter((r) => myOrderIds.has(r.order_id))
    .map((r) => ({
      source: "환불접수" as const,
      label: `${orderNoById.get(r.order_id) ?? r.order_id} ${r.type}`,
      date: r.created_at,
      amount: r.amount,
    }));
  const refunds = [...cancelRefunds, ...returnRefunds].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );

  return {
    header: { name: profile?.name || name, profile, summary },
    subscriptions,
    orders: orderCards,
    refunds,
  };
}
