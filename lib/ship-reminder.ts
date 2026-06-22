// 발송 전날 예고 — 특정 발송일에 배송될 건을 배송 명단 SSOT(buildRosterForDate)로 산출하고,
//   고객에게 보낼 예고 문구를 만든다(순수). 스케줄러(netlify/functions/ship-reminder)가 쓴다.
//   해지·정지·회차소진 구독 제외는 관리자 배송 탭과 동일 로직 → 잘못된 예고를 막는다.
import { buildRosterMaps } from "./roster-maps";
import { buildRosterForDate } from "./delivery-roster";
import type { DeliveryDay } from "./cart";

// 서버(보안 RPC)에서 받아오는 원자료 행 타입 — 로스터·문구에 필요한 필드만.
export type ReminderOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type: string; // '구독' | '단품'
  block_weeks: number | null;
  shipping_fee: number | null;
  created_at: string;
  ship_date: string | null; // 단품 발송 예정일(YYYY-MM-DD)
  ship_name: string;
  ship_phone: string | null;
  delivery_method: string | null; // '택배' | '방문수령'
  renews_slot_id: number | null;
  is_gift: boolean;
  gifter_name: string | null;
};
export type ReminderItem = {
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: DeliveryDay; // 단품은 런타임상 null일 수 있으나 로스터가 ship_date로 매칭
  qty: number;
  unit_price: number;
};
export type ReminderSlot = {
  id: number;
  order_id: string | null;
  status: string;
  started_at: string | null;
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
};

export type ReminderTarget = {
  orderId: string;
  orderNo: string;
  shipDate: string;
  shipName: string;
  shipPhone: string | null;
  isGift: boolean;
  gifterName: string | null;
  items: { product_name: string; volume: string; qty: number }[];
  kind: "정기" | "단품";
};

// 특정 발송일(dateISO)에 배송될 건 중 아직 예고하지 않은 대상만 추린다.
//   remindedOrderIds = 그 발송일에 이미 예고 보낸 주문(중복 예고 방지).
export function buildReminderTargets(input: {
  dateISO: string;
  orders: ReminderOrder[];
  items: ReminderItem[];
  slots: ReminderSlot[];
  remindedOrderIds: ReadonlySet<string>;
}): ReminderTarget[] {
  const maps = buildRosterMaps(input.orders, input.items, input.slots);
  const entries = buildRosterForDate({
    dateISO: input.dateISO,
    items: input.items,
    orderById: maps.orderById,
    slotByOrder: maps.slotByOrder,
    confirmedOrderIds: maps.confirmedOrderIds,
    pausedOrderIds: maps.pausedOrderIds,
    blocksBySlot: maps.blocksBySlot,
    slotIdByOrder: maps.slotIdByOrder,
    slotById: maps.slotById,
  });

  const out: ReminderTarget[] = [];
  for (const e of entries) {
    if (input.remindedOrderIds.has(e.order.id)) continue;
    if (!e.order.ship_phone) continue; // 전화번호 없으면 보낼 수 없음
    out.push({
      orderId: e.order.id,
      orderNo: e.order.order_no,
      shipDate: input.dateISO,
      shipName: e.order.ship_name,
      shipPhone: e.order.ship_phone,
      isGift: e.order.is_gift,
      gifterName: e.order.gifter_name,
      items: e.items.map((it) => ({
        product_name: it.product_name,
        volume: it.volume,
        qty: it.qty,
      })),
      kind: e.kind,
    });
  }
  return out;
}

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;

// 예고 문구. 받는 분(ship_phone) 기준 — 내일 어떤 제품이 가는지 미리 안내.
export function buildShipReminderMessage(t: ReminderTarget): { text: string; subject: string } {
  const [, mo, da] = t.shipDate.split("-");
  const dateLabel = mo && da ? `${Number(mo)}월 ${Number(da)}일` : t.shipDate;
  const weekday = WEEKDAY_LABEL[new Date(`${t.shipDate}T00:00:00`).getDay()];
  const summary = t.items
    .map((it) => `${it.product_name} ${it.volume}${it.qty > 1 ? ` ${it.qty}개` : ""}`)
    .join(", ");
  const name = t.shipName || "고객";
  const text =
    `[송영신목장] ${name}님, 내일 ${dateLabel}(${weekday}) 발송 예정입니다.\n` +
    `${summary}\n` +
    `갓 짜낸 신선함 그대로 정성껏 보내드리겠습니다.`;
  return { text, subject: "[송영신목장] 내일 발송 예정 안내" };
}
