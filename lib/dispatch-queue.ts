// 배송 시트(관리자 '배송 일괄처리') 행 산출 — 순수 SSOT.
//
//   ★ 왜 이 파일이 필요한가 (2026-08 사고)
//     배송 시트는 주문 상태가 '입금확인·배송준비·배송중'인 주문만 담고 있었다. 그런데 정기구독은
//     주문 1건이 매주 재발송되는 구조라, 한 회차를 '도착확인'하면 그 주문 상태가 배송완료로 바뀌고
//     ─ 다음 주 회차부터 시트에서 통째로 사라졌다. 실제로 월요일 배송 대상 30여 명 중 3명만 떴다.
//     주문 상태는 '그 주문의 마지막 회차 상태'일 뿐, 이번 회차의 상태가 아니다. 이번 회차를
//     보냈는지는 회차 이력(shipment_log = shippedKeys)만이 안다.
//
//   그래서 날짜별 시트는 '기간별 배송 명단'과 완전히 같은 SSOT(buildRosterForDate)에서 만든다.
//   두 화면이 갈리면 과배송·누락이 나므로, 갈릴 여지 자체를 없앤다. 시트에만 필요한 것은
//   ① 지난 미출고 단품 이월분과 ② 회차 표기(n/m회)뿐이라 여기서 얹는다.
import type { DeliveryDay } from "./cart";
import {
  buildRosterForDate,
  type RosterOrderFields,
  type RosterItemFields,
} from "./delivery-roster";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";
import { isCarriedOver } from "./dispatch-overdue";
import type { RawBlock } from "./subscription-timeline";

// 단품 주문은 1건 = 발송 1회다. 주문 상태가 곧 그 발송의 상태이므로 완료·취소는 시트에서 뺀다.
export const ONCE_SHIPPABLE = ["입금확인", "배송준비", "배송중"] as const;
// 구독 주문은 1건 = 여러 회차다. 주문 상태(배송완료 포함)로 회차를 거르면 안 된다 —
//   해지·정지·회차소진 제외는 슬롯 스케줄(dispatchScheduleForSlot / 활성 블록)이 판정한다.
export const SUB_SHIPPABLE = ["입금확인", "배송준비", "배송중", "배송완료"] as const;

// 시트 행의 원자료(주문 + 그 행이 실제로 보낼 품목 + 요일 + 발송일).
export type DispatchSlice<O, I> = {
  order: O;
  items: I[]; // 이 행에 나가는 품목만(같은 주문의 다른 요일분은 다른 행)
  day: DeliveryDay | null; // 정기의 배송요일. 단품은 null
  kind: "정기" | "단품";
  carriedOver: boolean; // 지난 발송일을 넘긴 미출고 단품
  shipISO: string; // 이 행의 발송(예정)일 — 재고 차감·회차 이력의 키
  round: number;
  total: number; // 총 회차(구독). 단품 1, 미상 0
  remaining: number;
};

type QueueOrderFields = RosterOrderFields & {
  status: string;
  shipped_at: string | null;
  created_at: string;
};

// 구독 회차 — 시작일 대비 발송일이 몇 주차인지(1-base). 정지·총회차를 모르는
//   비(非)슬롯 경로(단품 등) 전용 보조 계산. 슬롯이 있으면 dispatchScheduleForSlot 를 쓴다.
export function roundFor(orderType: string, shipISO: string, startedISO: string | null): number {
  if (orderType === "단품" || !startedISO) return 1;
  const start = Date.parse(`${startedISO.slice(0, 10)}T00:00:00`);
  const ship = Date.parse(`${shipISO}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(ship) || ship < start) return 1;
  const weeks = Math.floor((ship - start) / (7 * 86_400_000));
  return weeks + 1;
}

// timestamptz/ISO → 'YYYY-MM-DD'. 발송일 키는 반드시 달력일이어야 회차 이력과 맞물린다.
function dateOnly(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

export type QueueMaps<O, S> = {
  orderById: ReadonlyMap<string, O>;
  slotByOrder: ReadonlyMap<string, S>;
  slotsByOrder?: ReadonlyMap<string, S[]>;
  slotById?: ReadonlyMap<number, S>;
  confirmedOrderIds: ReadonlySet<string>;
  pausedOrderIds: ReadonlySet<string>;
  blocksBySlot?: ReadonlyMap<number, RawBlock[]>;
  slotIdByOrder?: ReadonlyMap<string, number>;
  slotIdByOrderDay?: ReadonlyMap<string, number>;
};

// 이 행(주문·요일)의 회차를 계산할 슬롯. 요일이 맞는 슬롯 → 주문 매핑 슬롯 순.
//   한 주문이 두 요일을 구독하면 슬롯이 둘이고 시작일·정지일수가 서로 다르다.
function slotForRow<O, S extends DispatchSlotInfo & { delivery_day?: string | null }>(
  maps: QueueMaps<O, S>,
  orderId: string,
  day: DeliveryDay | null
): S | undefined {
  if (day) {
    const byDay = maps.slotsByOrder?.get(orderId)?.find((s) => s.delivery_day === day);
    if (byDay) return byDay;
    const id = maps.slotIdByOrderDay?.get(`${orderId}|${day}`);
    const bySlotId = id != null ? maps.slotById?.get(id) : undefined;
    if (bySlotId) return bySlotId;
  }
  const chainId = maps.slotIdByOrder?.get(orderId);
  return (chainId != null ? maps.slotById?.get(chainId) : undefined) ?? maps.slotByOrder.get(orderId);
}

// 회차 표기(n/m회·남은 회차). 연장 체인 슬롯은 슬롯 단위(원주문 block_weeks + extended_weeks)로 센다.
function roundInfo<O extends QueueOrderFields, S extends DispatchSlotInfo & { order_id?: string | null; delivery_day?: string | null }>(
  maps: QueueMaps<O, S>,
  order: O,
  day: DeliveryDay | null,
  shipISO: string
): Pick<DispatchSlice<O, never>, "round" | "total" | "remaining"> {
  if (order.order_type === "단품") return { round: 1, total: 1, remaining: 0 };
  const slot = slotForRow(maps, order.id, day);
  if (!slot) {
    return { round: roundFor(order.order_type, shipISO, order.created_at), total: 0, remaining: 0 };
  }
  // 연장 체인이면 총 회차는 원주문 기준(연장주문의 block_weeks 는 그 블록 몫일 뿐).
  const chainSlotId = maps.slotIdByOrderDay?.get(`${order.id}|${day ?? ""}`) ?? maps.slotIdByOrder?.get(order.id);
  const chainSlot = chainSlotId != null ? maps.slotById?.get(chainSlotId) : undefined;
  const baseSlot = chainSlot ?? slot;
  const originalId = (baseSlot as { order_id?: string | null }).order_id ?? order.id;
  const weeks = maps.orderById.get(originalId)?.block_weeks ?? order.block_weeks ?? 0;
  const sch = dispatchScheduleForSlot(baseSlot, weeks, shipISO);
  return { round: sch.round, total: sch.total, remaining: sch.remaining };
}

// 선택 날짜(dateISO)에 실제로 나가야 하는 시트 행 — 기간별 배송 명단과 같은 SSOT + 단품 이월분.
export function buildDispatchSlicesForDate<
  O extends QueueOrderFields,
  I extends RosterItemFields,
  S extends DispatchSlotInfo & { order_id?: string | null; delivery_day?: string | null },
>(params: {
  dateISO: string;
  orders: readonly O[];
  items: I[];
  itemsByOrder: ReadonlyMap<string, I[]>;
  maps: QueueMaps<O, S>;
}): DispatchSlice<O, I>[] {
  const { dateISO, orders, items, itemsByOrder, maps } = params;
  const out: DispatchSlice<O, I>[] = [];

  const entries = buildRosterForDate<O, I>({
    dateISO,
    items,
    orderById: maps.orderById,
    slotByOrder: maps.slotByOrder,
    confirmedOrderIds: maps.confirmedOrderIds,
    pausedOrderIds: maps.pausedOrderIds,
    blocksBySlot: maps.blocksBySlot,
    slotIdByOrder: maps.slotIdByOrder,
    slotById: maps.slotById,
    slotIdByOrderDay: maps.slotIdByOrderDay,
  });

  for (const e of entries) {
    // 단품은 주문 상태 = 그 발송의 상태 → 완료분은 작업 목록에서 뺀다(정기는 회차 이력이 판정).
    if (e.kind === "단품" && !(ONCE_SHIPPABLE as readonly string[]).includes(e.order.status)) continue;
    const shipISO = e.kind === "단품" ? (e.order.ship_date ?? dateISO) : dateISO;
    out.push({
      order: e.order,
      items: e.items,
      day: e.day,
      kind: e.kind,
      carriedOver: false,
      shipISO,
      ...roundInfo(maps, e.order, e.day, shipISO),
    });
  }

  // 지난 미출고 단품 이월분 — 그날 못 보내면 다음 날 명단에서 사라지므로 끌어온다.
  const seen = new Set(out.map((r) => `${r.order.id}|${r.shipISO}`));
  for (const o of orders) {
    if (o.order_type !== "단품") continue;
    if (o.delivery_method === "방문수령") continue;
    if (!maps.confirmedOrderIds.has(o.id)) continue;
    if (!(ONCE_SHIPPABLE as readonly string[]).includes(o.status)) continue;
    if (!isCarriedOver(o, dateISO)) continue;
    const shipISO = o.ship_date ?? dateISO;
    if (seen.has(`${o.id}|${shipISO}`)) continue;
    const its = itemsByOrder.get(o.id) ?? [];
    out.push({
      order: o,
      items: its,
      day: null,
      kind: "단품",
      carriedOver: true,
      shipISO,
      round: 1,
      total: 1,
      remaining: 0,
    });
  }

  return out;
}

// 날짜 필터를 끈 '전체' 보기 — 발송 대상 주문 전부를 요일별로 펼친다.
//   해지·정지·회차소진 구독은 asOfISO 기준으로 제외해 끝난 구독이 목록에 남지 않게 한다.
export function buildDispatchSlicesAll<
  O extends QueueOrderFields,
  I extends RosterItemFields,
  S extends DispatchSlotInfo & { order_id?: string | null; delivery_day?: string | null },
>(params: {
  asOfISO: string;
  orders: readonly O[];
  itemsByOrder: ReadonlyMap<string, I[]>;
  maps: QueueMaps<O, S>;
}): DispatchSlice<O, I>[] {
  const { asOfISO, orders, itemsByOrder, maps } = params;
  const out: DispatchSlice<O, I>[] = [];

  for (const o of orders) {
    if (o.delivery_method === "방문수령") continue;
    const its = itemsByOrder.get(o.id) ?? [];

    if (o.order_type === "단품") {
      if (!(ONCE_SHIPPABLE as readonly string[]).includes(o.status)) continue;
      const shipISO = o.ship_date ?? dateOnly(o.shipped_at) ?? asOfISO;
      out.push({
        order: o,
        items: its,
        day: null,
        kind: "단품",
        carriedOver: isCarriedOver(o, asOfISO),
        shipISO,
        round: 1,
        total: 1,
        remaining: 0,
      });
      continue;
    }

    if (!(SUB_SHIPPABLE as readonly string[]).includes(o.status)) continue;
    // 연장 결제 주문은 원주문 행이 슬롯의 배송을 대표한다(날짜 없이는 구간을 가릴 수 없다).
    if (o.renews_slot_id != null) continue;
    if (maps.pausedOrderIds.has(o.id)) continue;

    const shipISO = dateOnly(o.shipped_at) ?? asOfISO;
    // 요일별로 행을 나눈다 — 월+수 동시 구독은 요일마다 별개의 발송이다.
    const byDay = new Map<DeliveryDay, I[]>();
    for (const it of its) {
      if (!it.delivery_day) continue;
      const arr = byDay.get(it.delivery_day) ?? [];
      arr.push(it);
      byDay.set(it.delivery_day, arr);
    }
    const groups: [DeliveryDay | null, I[]][] = byDay.size > 0 ? [...byDay] : [[null, its]];
    for (const [day, dayItems] of groups) {
      const slot = slotForRow(maps, o.id, day);
      if (slot && dispatchScheduleForSlot(slot, o.block_weeks ?? 0, shipISO).excluded) continue;
      out.push({
        order: o,
        items: dayItems,
        day,
        kind: "정기",
        carriedOver: false,
        shipISO,
        ...roundInfo(maps, o, day, shipISO),
      });
    }
  }

  return out;
}
