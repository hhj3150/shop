// 발송 전날 예고 — 특정 발송일에 배송될 건을 배송 명단 SSOT(buildRosterForDate)로 산출하고,
//   고객에게 보낼 예고 문구를 만든다(순수). 스케줄러(netlify/functions/ship-reminder)가 쓴다.
//   해지·정지·회차소진 구독 제외는 관리자 배송 탭과 동일 로직 → 잘못된 예고를 막는다.
import { buildRosterMaps } from "./roster-maps";
import { buildRosterForDate } from "./delivery-roster";
import { deliveryDayHitsDate } from "./ship-date";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "./cart";

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
  shipped_at: string | null; // 주문 행의 발송일(단품은 그 주문의 실제 발송 여부)
  tracking_no: string | null; // 송장이 있으면 이미 발송 처리된 건
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
  // 공휴일이 겹쳐 원래 요일이 아닌 날에 나가는 회차면 그 원래 요일. 아니면 null.
  //   손님은 "내 배송일은 금요일인데 왜 목요일에?" 하고 놀란다 — 예고 문자에서 미리 설명한다.
  shiftedFromDay: DeliveryDay | null;
};

// 발송일 하루 전(예고를 보내는 날) — dateISO 의 전날. KST 달력일 문자열 연산.
function eveOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// timestamptz(ISO) → KST 달력일 'YYYY-MM-DD'. KST는 DST 없는 UTC+9.
function kstDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 특정 발송일(dateISO)에 배송될 건 중 아직 예고하지 않은 대상만 추린다.
//   remindedOrderIds  = 그 발송일에 이미 예고 보낸 주문(중복 예고 방지).
//   dispatchedOrderIds = 그 발송일분을 이미 출고(송장 기록)한 주문 — 예고 대상에서 뺀다.
//     ★ 관리자는 발송일보다 며칠 앞서 송장을 등록하기도 한다(예: 8/31 발송분을 8/28 처리).
//       그러면 손님은 이미 '상품이 발송되었습니다 + 송장번호' 문자를 받은 뒤인데, 전날 저녁에
//       "내일 발송 예정입니다" 예고가 또 나간다(실제 사고 SY20260809-5830: 8/14 발송 → 8/17 예고).
export function buildReminderTargets(input: {
  dateISO: string;
  orders: ReminderOrder[];
  items: ReminderItem[];
  slots: ReminderSlot[];
  remindedOrderIds: ReadonlySet<string>;
  dispatchedOrderIds?: ReadonlySet<string>;
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

  const eveISO = eveOf(input.dateISO);
  const out: ReminderTarget[] = [];
  for (const e of entries) {
    if (input.remindedOrderIds.has(e.order.id)) continue;
    if (!e.order.ship_phone) continue; // 전화번호 없으면 보낼 수 없음
    // 이미 출고된 회차 — 발송 안내 문자가 나간 뒤라 예고는 중복·모순이다.
    if (input.dispatchedOrderIds?.has(e.order.id)) continue;
    if (e.kind === "단품") {
      // 단품은 주문 1건 = 발송 1회다. 송장이 있거나 이미 배송중/배송완료면 발송이 끝난 것
      //   (회차 이력이 없어 dispatchedOrderIds 로 못 잡는 레거시 건까지 덮는다).
      if (e.order.tracking_no || e.order.shipped_at) continue;
      if (e.order.status === "배송중" || e.order.status === "배송완료") continue;
      // 주문 당일 저녁의 예고는 몇 시간 전 '주문 접수·입금 안내' 문자가 이미 같은 발송일을
      //   알린 뒤라 중복이다(예: 15:35 접수 문자 → 18:08 예고). 그날 주문분은 건너뛴다.
      if (kstDate(e.order.created_at) === eveISO) continue;
    }
    // 정기 회차가 원래 요일이 아닌 날에 나가는가(공휴일 미루기·앞당김).
    const day = e.kind === "정기" ? (e.items[0]?.delivery_day ?? null) : null;
    const shiftedFromDay =
      day && deliveryDayHitsDate(day, input.dateISO).shifted ? day : null;
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
      shiftedFromDay,
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
  // 공휴일로 발송일이 옮겨진 회차는 이유를 먼저 알린다 — 문의를 만들지 않는 가장 싼 방법이다.
  const shiftNote = t.shiftedFromDay
    ? `※ 원래 ${DELIVERY_DAY_LABEL[t.shiftedFromDay]} 배송분입니다. 공휴일이 겹쳐 발송일을 옮겼습니다.\n`
    : "";
  const text =
    `[송영신목장] ${name}님, 내일 ${dateLabel}(${weekday}) 발송 예정입니다.\n` +
    shiftNote +
    `${summary}\n` +
    `갓 짜낸 신선함 그대로 정성껏 보내드리겠습니다.`;
  return { text, subject: "[송영신목장] 내일 발송 예정 안내" };
}
