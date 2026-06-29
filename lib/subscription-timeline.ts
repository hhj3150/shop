// 구독 타임라인 — 블록(원주문+연장주문) 상속·회차 구간·활성 블록·견적·환불 순수 함수.
// 외부 의존: ./subscription-schedule, ./cart (타입), ./products (할인/단가)

import type { DeliveryDay } from "./cart";
import { computeSchedule } from "./subscription-schedule";
import {
  discountForPeriod,
  periodWeeks,
  subscribePrice,
  MIN_ORDER_KRW,
  type SubPeriod,
} from "./products";

// ─── 데이터 모델 ───────────────────────────────────────────────────────────

export type BlockItem = {
  productName: string;
  volume: string;
  qty: number;
  unitPrice: number; // 할인 적용된 회당 단가 (order_items.unit_price)
};

// 원자료 블록 — order(block_weeks) + 자기 order_items 에서 구성.
export type RawBlock = {
  orderId: string;
  weeks: number;                   // block_weeks
  deliveryDay: DeliveryDay | null; // 자기 items 있을 때만; null이면 상속
  shippingPerWeek: number;         // 회당 배송비 (order.shipping_fee / weeks)
  items: BlockItem[];              // 빈 배열이면 직전 블록 상속(레거시)
};

// 상속·누적회차 적용된 유효 블록.
export type ResolvedBlock = {
  orderId: string;        // 발송 attribution 용 — 이 블록의 items 가 가진 실제 order_id
  deliveryDay: DeliveryDay;
  items: BlockItem[];
  shippingPerWeek: number;
  fromRound: number;      // 1-base 포함
  toRound: number;        // 1-base 미포함 (= fromRound + weeks)
};

export type TimelineInput = {
  startedAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  blocks: RawBlock[];
};

// ─── Task 1.1: normalizeBlocks ────────────────────────────────────────────

export function normalizeBlocks(blocks: RawBlock[]): ResolvedBlock[] {
  const out: ResolvedBlock[] = [];
  let cursor = 1;
  type BlockSrc = Pick<ResolvedBlock, "orderId" | "deliveryDay" | "items" | "shippingPerWeek">;
  let inherited: BlockSrc | null = null;
  for (const b of blocks) {
    const hasOwn = b.items.length > 0 && b.deliveryDay != null;
    const src: BlockSrc | null = hasOwn
      ? { orderId: b.orderId, deliveryDay: b.deliveryDay as DeliveryDay, items: b.items, shippingPerWeek: b.shippingPerWeek }
      : inherited;
    if (!src) {
      // 첫 블록이 비어있는 비정상 입력 — 빈 구간으로 스킵하되 회차는 전진.
      cursor += Math.max(0, b.weeks);
      continue;
    }
    out.push({ ...src, fromRound: cursor, toRound: cursor + Math.max(0, b.weeks) });
    cursor += Math.max(0, b.weeks);
    inherited = src;
  }
  return out;
}

// ─── Task 1.2: activeBlockForRound / activeBlockForDate ───────────────────

export function activeBlockForRound(blocks: ResolvedBlock[], round: number): ResolvedBlock | null {
  if (round < 1) return null;
  return blocks.find((b) => round >= b.fromRound && round < b.toRound) ?? null;
}

export function totalWeeks(blocks: RawBlock[]): number {
  return blocks.reduce((s, b) => s + Math.max(0, b.weeks), 0);
}

// 발송일의 '활성 블록 주문 id' — 해지·정지면 null. 발송 명단/배송 시트가 한 슬롯의 여러
//   블록(원구독+연장) 중 그날 발송할 단 하나의 주문만 고르게 하는 게이팅 키.
//   buildRosterForDate(기간별 명단)와 DispatchPanel(배송 시트)이 같은 SSOT 를 쓰도록 공유한다.
export function activeBlockOrderForDate(
  slot: {
    status: string;
    started_at: string | null;
    paused: boolean;
    paused_at: string | null;
    paused_days: number;
  },
  blocks: RawBlock[],
  dateISO: string
): string | null {
  if (slot.status === "해지" || slot.paused) return null;
  const active = activeBlockForDate(
    {
      startedAt: slot.started_at,
      paused: slot.paused,
      pausedAt: slot.paused_at,
      pausedDays: slot.paused_days,
      blocks,
    },
    dateISO
  );
  return active?.orderId ?? null;
}

export function activeBlockForDate(
  input: TimelineInput,
  dateISO: string
): ResolvedBlock | null {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    {
      startedAt: input.startedAt,
      totalWeeks: total,
      paused: input.paused,
      pausedAt: input.pausedAt,
      pausedDays: input.pausedDays,
    },
    new Date(`${dateISO}T00:00:00`)
  );
  if (!sched.started || input.paused) return null;
  if (sched.endDate != null && dateISO > sched.endDate) return null; // 소진
  if (input.startedAt != null && dateISO < input.startedAt) return null; // 시작 전
  const round = Math.max(1, sched.delivered);
  return activeBlockForRound(resolved, round);
}

// ─── Task 1.3: renewalQuote ───────────────────────────────────────────────

export type QuoteItem = { listPrice: number; qty: number };
export type RenewalQuote = {
  weeks: number;
  unitTotalPerDelivery: number; // 할인 적용 회당 상품 합계
  listTotalPerDelivery: number; // 정가 회당 합계(참고)
  shipping: number;
  total: number;
  belowMin: boolean;            // 회당 < MIN_ORDER_KRW
};

export function renewalQuote(
  items: QuoteItem[],
  period: SubPeriod,
  shippingPerWeek: number
): RenewalQuote {
  const rate = discountForPeriod(period);
  if (rate == null) throw new Error(`허용되지 않은 구독 기간: ${period}`);
  const weeks = periodWeeks(period);
  let unit = 0;
  let list = 0;
  for (const it of items) {
    if (it.qty <= 0) continue;
    unit += subscribePrice(it.listPrice, rate) * it.qty;
    list += it.listPrice * it.qty;
  }
  const shipping = shippingPerWeek * weeks;
  return {
    weeks,
    unitTotalPerDelivery: unit,
    listTotalPerDelivery: list,
    shipping,
    total: unit * weeks + shipping,
    belowMin: unit < MIN_ORDER_KRW,
  };
}

// ─── Task 1.4: refundByBlocks ─────────────────────────────────────────────

export function refundByBlocks(input: TimelineInput, asOfDateISO: string): number {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    {
      startedAt: input.startedAt,
      totalWeeks: total,
      paused: input.paused,
      pausedAt: input.pausedAt,
      pausedDays: input.pausedDays,
    },
    new Date(`${asOfDateISO}T00:00:00`)
  );
  const delivered = input.startedAt ? sched.delivered : 0;
  let refund = 0;
  for (let round = delivered + 1; round <= total; round++) {
    const b = activeBlockForRound(resolved, round);
    if (!b) continue;
    const perDelivery = b.items.reduce((s, it) => s + it.unitPrice * it.qty, 0) + b.shippingPerWeek;
    refund += perDelivery;
  }
  return refund;
}
