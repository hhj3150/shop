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
  creditKrw: number;               // 이 주문에 선차감된 추천 적립금(원)
  items: BlockItem[];              // 빈 배열이면 직전 블록 상속(레거시)
};

// 상속·누적회차 적용된 유효 블록.
export type ResolvedBlock = {
  orderId: string;        // 발송 attribution 용 — 이 블록의 items 가 가진 실제 order_id
  deliveryDay: DeliveryDay;
  items: BlockItem[];
  shippingPerWeek: number;
  creditKrw: number;      // 이 블록 주문에 선차감된 추천 적립금(원) — 블록 회차에 고르게 안분한다
  fromRound: number;      // 1-base 포함
  toRound: number;        // 1-base 미포함 (= fromRound + weeks)
};

export type TimelineInput = {
  startedAt: string | null;
  paused: boolean;
  pausedAt: string | null;
  pausedDays: number;
  // 1회차 실제 배송일(앵커가 공휴일이면 다음 영업일). computeSchedule 과 같은 입력을 써야
  //   '이 날짜의 활성 블록'과 '이 날짜의 회차'가 갈리지 않는다(과·미배송 방지).
  firstShipDate?: string | null;
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
    // 적립금은 상속하지 않는다 — items·단가는 레거시 빈 블록이 직전 블록에서 물려받지만,
    //   적립금은 '그 주문에 실제로 선차감된 금액'이라 블록 자신의 값을 써야 한다.
    out.push({
      ...src,
      creditKrw: Math.max(0, b.creditKrw ?? 0),
      fromRound: cursor,
      toRound: cursor + Math.max(0, b.weeks),
    });
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
    first_ship_date?: string | null;
    paused: boolean;
    paused_at: string | null;
    paused_days: number;
  },
  blocks: RawBlock[],
  dateISO: string,
  // 실제 발송 수(shipment_log). 미지정이면 옛 동작(날짜 기준).
  shippedCount?: number | null
): string | null {
  if (slot.status === "해지" || slot.paused) return null;
  const active = activeBlockForDate(
    {
      startedAt: slot.started_at,
      firstShipDate: slot.first_ship_date ?? null,
      paused: slot.paused,
      pausedAt: slot.paused_at,
      pausedDays: slot.paused_days,
      blocks,
    },
    dateISO,
    shippedCount
  );
  return active?.orderId ?? null;
}

export function activeBlockForDate(
  input: TimelineInput,
  dateISO: string,
  // 이 슬롯이 실제로 내보낸 회차 수(shipment_log 기준, 이 발송일 '전'까지).
  //   주면 '이번에 나갈 회차'를 발송 수 + 1 로 잡는다 — 날짜로 세면 결제한 회차가 증발한다.
  //
  //   ★ 실사고(2026-10): 연장 입금 전 공백 5주를 날짜가 5~9회차로 먹어, 8/18 에
  //     delivered=10 이 나왔다. 그 회차의 블록을 고르니 5~9회차는 영영 건너뛰어졌고,
  //     손님은 12주를 결제하고 7회만 받게 됐다.
  //   미지정이면 옛 동작(날짜 기준) 그대로.
  shippedCount?: number | null
): ResolvedBlock | null {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    {
      startedAt: input.startedAt,
      firstShipDate: input.firstShipDate ?? null,
      totalWeeks: total,
      paused: input.paused,
      pausedAt: input.pausedAt,
      pausedDays: input.pausedDays,
      shippedCount,
    },
    new Date(`${dateISO}T00:00:00`)
  );
  if (!sched.started || input.paused) return null;
  if (input.startedAt != null && dateISO < input.startedAt) return null; // 시작 전

  // 소진 판정.
  //   · 발송 수를 알면 따로 볼 것이 없다 — 결제분을 다 보냈으면 round(= 발송수 + 1)가
  //     블록 범위를 벗어나 아래 activeBlockForRound 가 null 을 낸다. 여기서 한 번 더
  //     검사하면 테스트로 가를 수 없는 죽은 분기가 되고, 나중에 읽는 사람이 두 규칙이
  //     있는 줄 오해한다.
  //   · 발송 수를 모르는 옛 경로에서만 '마지막 배송 예정일 경과'로 끊는다.
  if (shippedCount == null && sched.endDate != null && dateISO > sched.endDate) {
    return null;
  }

  // 이번에 나갈 회차.
  //   · 발송 수 기준: 이미 N 회 나갔으면 이번이 N+1 회차다.
  //   · 날짜 기준(옛): delivered 는 '오늘 자리까지' 포함하므로 그 값이 곧 이번 회차다.
  const round =
    shippedCount != null
      ? Math.max(1, sched.delivered + 1)
      : Math.max(1, sched.delivered);
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
  belowMin: boolean;            // 회당 정가 합계 < MIN_ORDER_KRW (정가 기준 — 신규 구독·단품과 동일)
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
    belowMin: list < MIN_ORDER_KRW,
  };
}

// ─── Task 1.4: refundByBlocks ─────────────────────────────────────────────

export function refundByBlocks(input: TimelineInput, asOfDateISO: string): number {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    {
      startedAt: input.startedAt,
      firstShipDate: input.firstShipDate ?? null,
      totalWeeks: total,
      paused: input.paused,
      pausedAt: input.pausedAt,
      pausedDays: input.pausedDays,
    },
    new Date(`${asOfDateISO}T00:00:00`)
  );
  const delivered = input.startedAt ? sched.delivered : 0;
  return refundForRoundsFrom(resolved, delivered + 1, total);
}

/**
 * 회차 [fromRound, total] 구간의 환불액 — 남은 회차의 (회당 상품합 + 회당 배송비) 합에서
 * 그 구간에 걸린 추천 적립금을 되뺀다. refundByBlocks·refundAmount 의 공통 본체다.
 *
 * ★ 적립금 안분(2026-09-24)
 *   주문 생성 시 orders.total_amount 는 이미 적립금을 뺀 '실결제액'인데, 환불은 정가 구성
 *   (order_items.unit_price)으로 계산한다. 그래서 되빼지 않으면 손님이 낸 적 없는 돈이 나간다.
 *   예) 회당 1만원 × 12회에 쿠폰 12,000원 → 실결제 108,000원. 첫 배송 전 해지 시
 *       옛 계산은 120,000원을 돌려줘 12,000원이 그대로 샜다.
 *   구독의 상품비·배송비가 이미 회차별로 안분돼 있으므로 적립금도 같은 규칙을 쓴다 —
 *   블록별로 `적립금 × 남은회차 / 블록회차` 를 뺀다(블록마다 자기 주문의 적립금을 가진다).
 *   전 회차가 남으면 적립금 전액이 빠져 환불액이 정확히 실결제액이 된다.
 */
export function refundForRoundsFrom(
  resolved: readonly ResolvedBlock[],
  fromRound: number,
  total: number
): number {
  let refund = 0;
  const remainingByBlock = new Map<ResolvedBlock, number>();
  for (let round = Math.max(1, fromRound); round <= total; round++) {
    const b = activeBlockForRound(resolved as ResolvedBlock[], round);
    if (!b) continue;
    refund += b.items.reduce((s, it) => s + it.unitPrice * it.qty, 0) + b.shippingPerWeek;
    remainingByBlock.set(b, (remainingByBlock.get(b) ?? 0) + 1);
  }
  for (const [b, remaining] of remainingByBlock) {
    const weeks = b.toRound - b.fromRound;
    if (weeks <= 0 || !(b.creditKrw > 0)) continue;
    refund -= Math.round((b.creditKrw * remaining) / weeks);
  }
  // 적립금이 상품비를 넘는 구성에서도 음수 환불은 나올 수 없다.
  return Math.max(0, refund);
}
