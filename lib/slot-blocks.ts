// 슬롯 주문 체인(원주문 + 연장주문)을 RawBlock[] 으로 변환하는 순수 함수.
// 외부 의존: ./subscription-timeline (타입), ./cart (DeliveryDay 타입)

import type { RawBlock, BlockItem } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// ─── 입력 타입 ─────────────────────────────────────────────────────────────────

export type OrderRow = {
  id: string;
  block_weeks: number;
  shipping_fee: number;
};

export type OrderItemRow = {
  delivery_day: DeliveryDay;
  qty: number;
  unit_price: number;
  product_name: string;
  volume: string;
};

// ─── 순수 함수 ─────────────────────────────────────────────────────────────────

function computeShippingPerWeek(shippingFee: number, blockWeeks: number): number {
  if (blockWeeks <= 0) return 0;
  return Math.round(shippingFee / blockWeeks);
}

function toBlockItem(row: OrderItemRow): BlockItem {
  return {
    productName: row.product_name,
    volume: row.volume,
    qty: row.qty,
    unitPrice: row.unit_price,
  };
}

function buildBlock(
  order: OrderRow,
  itemsByOrder: ReadonlyMap<string, OrderItemRow[]>
): RawBlock {
  const rows = itemsByOrder.get(order.id);
  const hasItems = rows != null && rows.length > 0;

  if (hasItems) {
    return {
      orderId: order.id,
      weeks: order.block_weeks,
      deliveryDay: rows![0].delivery_day, // all items share the same delivery_day
      shippingPerWeek: computeShippingPerWeek(order.shipping_fee, order.block_weeks),
      items: rows!.map(toBlockItem),
    };
  }

  // Legacy renewal: no items → inherit from previous block via normalizeBlocks
  return {
    orderId: order.id,
    weeks: order.block_weeks,
    deliveryDay: null,
    shippingPerWeek: computeShippingPerWeek(order.shipping_fee, order.block_weeks),
    items: [],
  };
}

/**
 * 슬롯의 원주문과 연장주문 배열을 RawBlock[] 으로 변환.
 *
 * - 원주문이 항상 첫 번째.
 * - 연장주문은 id 오름차순으로 정렬(입력 순서에 무관; 방어적 복사).
 * - items 있는 주문: deliveryDay = 첫 번째 item의 delivery_day, items 매핑.
 * - items 없는 주문(레거시): deliveryDay null, items [] — normalizeBlocks에서 상속.
 */
export function buildRawBlocks(
  originalOrder: OrderRow,
  renewalOrders: readonly OrderRow[],
  itemsByOrder: ReadonlyMap<string, OrderItemRow[]>
): RawBlock[] {
  const sortedRenewals = [...renewalOrders].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const originalBlock = buildBlock(originalOrder, itemsByOrder);
  const renewalBlocks = sortedRenewals.map((order) => buildBlock(order, itemsByOrder));

  return [originalBlock, ...renewalBlocks];
}
