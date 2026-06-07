// 선택 날짜의 배송 명단(정기 + 단품)을 산출하는 순수 로직.
//   관리자 '기간별 배송 명단'·CSV의 단일 진실 소스(SSOT). 배송 탭(DispatchPanel)과
//   동일한 dispatchScheduleForSlot 으로 해지·회차소진·정지 구독을 제외해 과배송을 막는다.
//   컴포넌트(OrderRow/ItemRow)의 전체 필드를 보존하도록 제네릭으로 둔다 — 로직엔 아래
//   최소 필드만 쓰고, 반환 entries 는 넘겨받은 원본 객체를 그대로 담는다.
import type { DeliveryDay } from "./cart";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";

// 로스터 판정에 필요한 주문 최소 필드.
export type RosterOrderFields = {
  id: string;
  order_type: string; // '구독' | '단품'
  block_weeks: number | null;
  ship_date: string | null; // 단품 발송 예정일(YYYY-MM-DD)
  ship_name: string;
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
//   excluded 판정(해지·회차소진·정지)은 해당 발송일(dateISO) 기준으로 평가한다.
export function buildRosterForDate<
  O extends RosterOrderFields,
  I extends RosterItemFields,
>(params: {
  dateISO: string;
  weekday: DeliveryDay | null;
  items: I[];
  orderById: ReadonlyMap<string, O>;
  slotByOrder: ReadonlyMap<string, DispatchSlotInfo>;
  confirmedOrderIds: ReadonlySet<string>;
  pausedOrderIds: ReadonlySet<string>;
  today?: Date; // 완료 판정 기준 시각(기본: 해당 발송일 자정). 테스트 주입용.
}): DeliveryEntry<O, I>[] {
  const {
    dateISO,
    weekday,
    items,
    orderById,
    slotByOrder,
    confirmedOrderIds,
    pausedOrderIds,
  } = params;
  const evalDate = params.today ?? new Date(`${dateISO}T00:00:00`);
  const entries: DeliveryEntry<O, I>[] = [];

  // ── 정기: 선택 날짜의 요일분 ──
  if (weekday) {
    const byOrder = new Map<string, I[]>();
    for (const it of items) {
      if (it.delivery_day !== weekday) continue;
      if (!confirmedOrderIds.has(it.order_id)) continue;
      if (pausedOrderIds.has(it.order_id)) continue;
      const arr = byOrder.get(it.order_id) ?? [];
      arr.push(it);
      byOrder.set(it.order_id, arr);
    }
    for (const [orderId, its] of byOrder) {
      const order = orderById.get(orderId);
      if (!order || order.order_type === "단품") continue;
      // 해지·회차소진(·정지) 구독은 그 발송일 기준 배송 대상이 아니다 → 명단에서 제외.
      //   배송 탭(DispatchPanel)과 동일한 SSOT 로 과배송을 막는다. 슬롯이 없으면 보수적으로 포함.
      const slot = slotByOrder.get(orderId);
      if (
        slot &&
        dispatchScheduleForSlot(slot, order.block_weeks ?? 0, dateISO, evalDate).excluded
      ) {
        continue;
      }
      entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
    }
  }

  // ── 단품: ship_date 일치분 ──
  const onceByOrder = new Map<string, I[]>();
  for (const it of items) {
    const order = orderById.get(it.order_id);
    if (!order || order.order_type !== "단품") continue;
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
