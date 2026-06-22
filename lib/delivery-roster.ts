// 선택 날짜의 배송 명단(정기 + 단품)을 산출하는 순수 로직.
//   관리자 '기간별 배송 명단'·CSV의 단일 진실 소스(SSOT). 배송 탭(DispatchPanel)과
//   동일한 dispatchScheduleForSlot 으로 해지·회차소진·정지 구독을 제외해 과배송을 막는다.
//   컴포넌트(OrderRow/ItemRow)의 전체 필드를 보존하도록 제네릭으로 둔다 — 로직엔 아래
//   최소 필드만 쓰고, 반환 entries 는 넘겨받은 원본 객체를 그대로 담는다.
import type { DeliveryDay } from "./cart";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";
import { deliveryDayHitsDate } from "./ship-date";
import { activeBlockForDate, type RawBlock } from "./subscription-timeline";

// 로스터 판정에 필요한 주문 최소 필드.
export type RosterOrderFields = {
  id: string;
  order_type: string; // '구독' | '단품'
  block_weeks: number | null;
  ship_date: string | null; // 단품 발송 예정일(YYYY-MM-DD)
  ship_name: string;
  delivery_method?: string | null; // '택배' | '방문수령' — 방문수령은 발송 대상 제외(미정의/널=택배 취급)
};

// 로스터 판정에 필요한 품목 최소 필드.
export type RosterItemFields = {
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: DeliveryDay;
  qty: number;
};

// 한 배송 건(정기 1회분 또는 단품 주문). kind 로 정기/단품을 구분.
export type DeliveryEntry<O, I> = {
  order: O;
  items: I[];
  sig: string;
  kind: "정기" | "단품";
};

// 같은 구성품(제품·용량·수량)끼리 묶기 위한 정렬 키 — 포장 편의.
export function compositionSignature(
  items: Pick<RosterItemFields, "product_name" | "volume" | "qty">[]
): string {
  return [...items]
    .map((it) => `${it.product_name} ${it.volume}×${it.qty}`)
    .sort((a, b) => a.localeCompare(b, "ko"))
    .join(" / ");
}

// 임의 날짜(dateISO)의 배송 명단. 정기는 그 요일분, 단품은 ship_date 일치분.
//   정렬: 정기 먼저, 같은 구성품끼리, 그 다음 이름순.
//   excluded 판정(해지·회차소진·정지)은 해당 발송일(dateISO)만으로 평가한다 — 외부 시계 비의존.
export function buildRosterForDate<
  O extends RosterOrderFields,
  I extends RosterItemFields,
>(params: {
  dateISO: string;
  items: I[];
  orderById: ReadonlyMap<string, O>;
  slotByOrder: ReadonlyMap<string, DispatchSlotInfo>;
  confirmedOrderIds: ReadonlySet<string>;
  pausedOrderIds: ReadonlySet<string>;
  // 슬롯별 블록 체인(원주문+연장주문) — 활성 블록만 발송하기 위한 입력. 없으면 폴백.
  blocksBySlot?: ReadonlyMap<number, RawBlock[]>;
  // 주문 id(원주문·연장주문 모두) → 슬롯 id. 활성 블록 조회 키.
  slotIdByOrder?: ReadonlyMap<string, number>;
  // 슬롯 id → 슬롯 상태. 활성 블록 게이팅의 슬롯 출처(연장주문은 slotByOrder 에 없으므로 필수).
  slotById?: ReadonlyMap<number, DispatchSlotInfo>;
}): DeliveryEntry<O, I>[] {
  const {
    dateISO,
    items,
    orderById,
    slotByOrder,
    confirmedOrderIds,
    pausedOrderIds,
    blocksBySlot,
    slotIdByOrder,
    slotById,
  } = params;
  const entries: DeliveryEntry<O, I>[] = [];

  // ── 정기: 이 날짜(공휴일 시프트 반영)에 배송되는 회차분 ──
  //   날짜 매칭은 슬롯 앵커가 아니라 '요일'만 본다(deliveryDayHitsDate) — 평소 당일 또는
  //   직전 그 요일이 공휴일이라 다음 영업일이 이 날짜인 시프트 도착일을 모두 한 번에 잡는다.
  const byOrder = new Map<string, I[]>();
  for (const it of items) {
    if (!confirmedOrderIds.has(it.order_id)) continue;
    if (pausedOrderIds.has(it.order_id)) continue;
    if (!deliveryDayHitsDate(it.delivery_day, dateISO).hits) continue; // 평소 당일 또는 공휴일 시프트 도착일
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push(it);
    byOrder.set(it.order_id, arr);
  }
  for (const [orderId, its] of byOrder) {
    const order = orderById.get(orderId);
    if (!order || order.order_type === "단품" || order.delivery_method === "방문수령") continue;

    // 활성 블록 게이팅: 슬롯의 블록 체인이 있으면 그 발송일의 활성 블록만 발송한다.
    //   ★ 연장주문 id 는 slotByOrder(원주문만)에 없으므로, 슬롯은 slotIdByOrder→slotById 로
    //   해석한다(원주문·연장주문 모두 동일 슬롯에 닿는다). 활성 블록의 orderId 와 이 그룹
    //   order_id 가 같을 때만 발송 → 한 슬롯의 여러 블록 이중발송을 막는다.
    //   블록 데이터가 없으면(레거시·미상) 기존 dispatchScheduleForSlot 폴백으로 보수적 포함.
    const slotId = slotIdByOrder?.get(orderId);
    const slotForBlocks = slotId != null ? slotById?.get(slotId) : undefined;
    const blocks = slotId != null ? blocksBySlot?.get(slotId) : undefined;
    if (slotForBlocks && blocks && blocks.length > 0) {
      // 해지·정지 슬롯은 발송 대상이 아니다(activeBlockForDate 는 status 미반영).
      if (slotForBlocks.status === "해지" || slotForBlocks.paused) continue;
      const active = activeBlockForDate(
        {
          startedAt: slotForBlocks.started_at,
          paused: slotForBlocks.paused,
          pausedAt: slotForBlocks.paused_at,
          pausedDays: slotForBlocks.paused_days,
          blocks,
        },
        dateISO
      );
      if (!active || active.orderId !== orderId) continue;
      entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
      continue;
    }

    // 폴백: 해지·회차소진(·정지) 구독은 그 발송일 기준 배송 대상이 아니다 → 명단에서 제외.
    //   배송 탭(DispatchPanel)과 동일한 SSOT 로 과배송을 막는다. 슬롯이 없으면 보수적으로 포함.
    //   폴백 슬롯은 원주문 매핑(slotByOrder)을 쓴다 — block_weeks 가 원주문 기준이기 때문.
    const fallbackSlot = slotByOrder.get(orderId);
    if (
      fallbackSlot &&
      dispatchScheduleForSlot(fallbackSlot, order.block_weeks ?? 0, dateISO).excluded
    ) {
      continue;
    }
    entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
  }

  // ── 단품: ship_date 일치분 ──
  const onceByOrder = new Map<string, I[]>();
  for (const it of items) {
    const order = orderById.get(it.order_id);
    if (!order || order.order_type !== "단품" || order.delivery_method === "방문수령") continue;
    if (order.ship_date !== dateISO) continue;
    if (!confirmedOrderIds.has(order.id)) continue;
    const arr = onceByOrder.get(order.id) ?? [];
    arr.push(it);
    onceByOrder.set(order.id, arr);
  }
  for (const [orderId, its] of onceByOrder) {
    const order = orderById.get(orderId)!;
    entries.push({ order, items: its, sig: compositionSignature(its), kind: "단품" });
  }

  const rank = (k: DeliveryEntry<O, I>["kind"]) => (k === "정기" ? 0 : 1);
  return entries.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      a.sig.localeCompare(b.sig, "ko") ||
      a.order.ship_name.localeCompare(b.order.ship_name, "ko")
  );
}
