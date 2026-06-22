// 배송 로스터 입력 맵 빌더(순수, SSOT). orders/items/slots 배열에서 buildRosterForDate 가
//   요구하는 맵·집합을 조립한다. 관리자 화면(app/admin/page.tsx)의 동일 memo 들과
//   '발송 전날 예고'(netlify/functions/ship-reminder)가 같은 결과를 쓰도록 한곳에 모은다.
//   → 한쪽만 고쳐 배송 명단이 갈리는(과/오배송) 사고를 막는다.
import { buildRawBlocks, type OrderRow as BlockOrderRow, type OrderItemRow as BlockItemRow } from "./slot-blocks";
import type { RawBlock } from "./subscription-timeline";
import type { DispatchSlotInfo } from "./dispatch-schedule";
import type { RosterOrderFields, RosterItemFields } from "./delivery-roster";

// 확정류 상태(발송 대상 후보). 입금대기·취소 등은 제외.
export const CONFIRMED_STATUSES = ["입금확인", "배송준비", "배송중", "배송완료"] as const;

// 맵 빌드에 필요한 최소 필드(반환 맵은 넘겨받은 원본 객체를 그대로 담는다 — 제네릭 보존).
type MapOrderFields = RosterOrderFields & {
  status: string;
  shipping_fee: number | null;
  created_at: string;
  renews_slot_id: number | null;
};
type MapItemFields = RosterItemFields & {
  unit_price: number;
};
type MapSlotFields = DispatchSlotInfo & {
  id: number;
  order_id: string | null;
};

export type RosterMaps<O, I, S> = {
  orderById: Map<string, O>;
  itemsByOrder: Map<string, I[]>;
  slotByOrder: Map<string, S>;
  slotById: Map<number, S>;
  confirmedOrderIds: Set<string>;
  pausedOrderIds: Set<string>;
  blocksBySlot: Map<number, RawBlock[]>;
  slotIdByOrder: Map<string, number>;
};

// 관리자 page.tsx 의 confirmedOrderIds/pausedOrderIds/orderById/slotByOrder/slotById/
//   renewalOrdersBySlot/blockItemsByOrder/blocksBySlot/slotIdByOrder 와 1:1 동등.
export function buildRosterMaps<
  O extends MapOrderFields,
  I extends MapItemFields,
  S extends MapSlotFields,
>(orders: readonly O[], items: readonly I[], slots: readonly S[]): RosterMaps<O, I, S> {
  const isConfirmed = (status: string) =>
    (CONFIRMED_STATUSES as readonly string[]).includes(status);

  const confirmedOrderIds = new Set<string>();
  for (const o of orders) if (isConfirmed(o.status)) confirmedOrderIds.add(o.id);

  // 일시정지 중인 구독의 주문 — 이번 회차 발송 집계에서 제외(횟수 보존, 종료일만 밀림).
  const pausedOrderIds = new Set<string>();
  for (const s of slots) if (s.paused && s.order_id) pausedOrderIds.add(s.order_id);

  const orderById = new Map<string, O>();
  for (const o of orders) orderById.set(o.id, o);

  // 주문 → 슬롯(원주문 기준). 연장은 원주문을 가리키므로 order_id 매핑.
  const slotByOrder = new Map<string, S>();
  for (const s of slots) if (s.order_id) slotByOrder.set(s.order_id, s);

  const slotById = new Map<number, S>();
  for (const s of slots) slotById.set(s.id, s);

  const itemsByOrder = new Map<string, I[]>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  }

  // 연장주문(renews_slot_id != null) 중 확정류만 슬롯별로 묶고 created_at,id 순 정렬.
  const renewalOrdersBySlot = new Map<number, O[]>();
  for (const o of orders) {
    if (o.renews_slot_id == null) continue;
    if (!isConfirmed(o.status)) continue;
    const arr = renewalOrdersBySlot.get(o.renews_slot_id) ?? [];
    arr.push(o);
    renewalOrdersBySlot.set(o.renews_slot_id, arr);
  }
  for (const [k, arr] of renewalOrdersBySlot) {
    renewalOrdersBySlot.set(
      k,
      [...arr].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    );
  }

  const toBlockOrder = (o: O): BlockOrderRow => ({
    id: o.id,
    block_weeks: o.block_weeks ?? 0,
    shipping_fee: o.shipping_fee ?? 0,
    created_at: o.created_at,
  });

  const blockItemsByOrder = new Map<string, BlockItemRow[]>();
  for (const [oid, rows] of itemsByOrder) {
    blockItemsByOrder.set(
      oid,
      rows.map((it) => ({
        delivery_day: it.delivery_day,
        qty: it.qty,
        unit_price: it.unit_price,
        product_name: it.product_name,
        volume: it.volume,
      }))
    );
  }

  const blocksBySlot = new Map<number, RawBlock[]>();
  for (const s of slots) {
    if (!s.order_id) continue;
    const original = orderById.get(s.order_id);
    if (!original) continue;
    const renewals = (renewalOrdersBySlot.get(s.id) ?? []).map(toBlockOrder);
    blocksBySlot.set(s.id, buildRawBlocks(toBlockOrder(original), renewals, blockItemsByOrder));
  }

  const slotIdByOrder = new Map<string, number>();
  for (const s of slots) if (s.order_id) slotIdByOrder.set(s.order_id, s.id);
  for (const [slotId, arr] of renewalOrdersBySlot) {
    for (const o of arr) slotIdByOrder.set(o.id, slotId);
  }

  return {
    orderById,
    itemsByOrder,
    slotByOrder,
    slotById,
    confirmedOrderIds,
    pausedOrderIds,
    blocksBySlot,
    slotIdByOrder,
  };
}
