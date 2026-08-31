import { describe, it, expect } from "vitest";
import { buildDispatchSlicesForDate, buildDispatchSlicesAll } from "./dispatch-queue";
import { buildRosterMaps } from "./roster-maps";
import { buildRosterForDate } from "./delivery-roster";

// ── 픽스처 ───────────────────────────────────────────────────────────────────
type O = {
  id: string;
  status: string;
  order_type: string;
  block_weeks: number | null;
  shipping_fee: number | null;
  created_at: string;
  ship_date: string | null;
  ship_name: string;
  delivery_method: string | null;
  renews_slot_id: number | null;
  shipped_at: string | null;
};
type I = {
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: "mon" | "tue" | "wed" | "thu" | "fri" | null;
  qty: number;
  unit_price: number;
};
type S = {
  id: number;
  order_id: string | null;
  status: string;
  started_at: string | null;
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
  delivery_day: string | null;
};

function order(over: Partial<O> & { id: string }): O {
  return {
    status: "배송완료",
    order_type: "구독",
    block_weeks: 12,
    shipping_fee: 0,
    created_at: "2026-06-01T00:00:00Z",
    ship_date: null,
    ship_name: `손님${over.id}`,
    delivery_method: "택배",
    renews_slot_id: null,
    shipped_at: null,
    ...over,
  };
}
function item(over: Partial<I> & { order_id: string }): I {
  return {
    product_name: "송영신우유",
    volume: "180ml",
    delivery_day: "mon",
    qty: 1,
    unit_price: 3000,
    ...over,
  };
}
function slot(over: Partial<S> & { id: number; order_id: string }): S {
  return {
    status: "활성",
    started_at: "2026-07-06", // 월요일 앵커(12주 구독이면 9월 말까지 회차가 남는다)
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    delivery_day: "mon",
    ...over,
  };
}

function sheet(dateISO: string, orders: O[], items: I[], slots: S[]) {
  const maps = buildRosterMaps(orders, items, slots);
  return buildDispatchSlicesForDate({
    dateISO,
    orders,
    items,
    itemsByOrder: maps.itemsByOrder,
    maps,
  });
}

const names = (rows: { order: O }[]) => rows.map((r) => r.order.ship_name).sort();

describe("buildDispatchSlicesForDate — 정기구독은 주문 상태로 사라지지 않는다", () => {
  // 2026-08-31(월). 7/6 시작 12주 구독이면 아직 회차가 남아 있다(8/31 = 8회차).
  const DATE = "2026-08-31";

  it("★회귀: 지난 회차를 도착확인해 주문이 '배송완료'가 돼도 다음 회차는 시트에 남는다", () => {
    // 사고 재현: 시트가 '입금확인·배송준비·배송중'만 담던 시절, 한 번 도착확인한 구독은
    //   그 주문 상태가 배송완료로 굳어 다음 주부터 통째로 사라졌다(월요일 30여 명 → 3명).
    const orders = [
      order({ id: "done", status: "배송완료", ship_name: "완료된주문" }),
      order({ id: "ing", status: "배송중", ship_name: "배송중주문" }),
      order({ id: "paid", status: "입금확인", ship_name: "입금확인주문" }),
    ];
    const items = [item({ order_id: "done" }), item({ order_id: "ing" }), item({ order_id: "paid" })];
    const slots = [
      slot({ id: 1, order_id: "done" }),
      slot({ id: 2, order_id: "ing" }),
      slot({ id: 3, order_id: "paid" }),
    ];
    expect(names(sheet(DATE, orders, items, slots))).toEqual([
      "배송중주문",
      "완료된주문",
      "입금확인주문",
    ]);
  });

  it("취소·입금대기 주문은 시트에 오르지 않는다", () => {
    const orders = [
      order({ id: "cancel", status: "취소", ship_name: "취소" }),
      order({ id: "wait", status: "입금대기", ship_name: "입금대기" }),
    ];
    const items = [item({ order_id: "cancel" }), item({ order_id: "wait" })];
    const slots = [slot({ id: 1, order_id: "cancel" }), slot({ id: 2, order_id: "wait" })];
    expect(sheet(DATE, orders, items, slots)).toEqual([]);
  });

  it("해지·일시정지·회차소진 구독은 제외한다", () => {
    const orders = [
      order({ id: "live", ship_name: "진행중" }),
      order({ id: "cancelled", ship_name: "해지" }),
      order({ id: "paused", ship_name: "정지" }),
      order({ id: "used", block_weeks: 4, ship_name: "회차소진" }), // 7/6+4주 → 7/27 종료
    ];
    const items = [
      item({ order_id: "live" }),
      item({ order_id: "cancelled" }),
      item({ order_id: "paused" }),
      item({ order_id: "used" }),
    ];
    const slots = [
      slot({ id: 1, order_id: "live" }),
      slot({ id: 2, order_id: "cancelled", status: "해지" }),
      slot({ id: 3, order_id: "paused", paused: true, paused_at: "2026-08-01" }),
      slot({ id: 4, order_id: "used" }),
    ];
    expect(names(sheet(DATE, orders, items, slots))).toEqual(["진행중"]);
  });

  it("방문수령은 택배 시트에서 빠진다", () => {
    const orders = [order({ id: "pickup", delivery_method: "방문수령" })];
    expect(sheet(DATE, orders, [item({ order_id: "pickup" })], [slot({ id: 1, order_id: "pickup" })])).toEqual([]);
  });

  it("회차 표기는 슬롯 기준(연장 회차 포함)으로 센다", () => {
    const orders = [order({ id: "o1", block_weeks: 12 })];
    const rows = sheet(DATE, orders, [item({ order_id: "o1" })], [slot({ id: 1, order_id: "o1", extended_weeks: 8 })]);
    expect(rows[0].total).toBe(20);
    expect(rows[0].round).toBe(8); // 7/6 시작 월요일 구독의 8/31 회차(하계휴무 이월 1주 반영)
    expect(rows[0].remaining).toBe(12);
  });
});

describe("buildDispatchSlicesForDate — 공휴일·목장 휴무", () => {
  const orders = [order({ id: "o1", ship_name: "월요일손님" })];
  const items = [item({ order_id: "o1" })];
  const slots = [slot({ id: 1, order_id: "o1" })];

  it("공휴일 당일(2026-08-17 광복절 대체)에는 아무도 뜨지 않는다", () => {
    expect(sheet("2026-08-17", orders, items, slots)).toEqual([]);
  });

  it("★회귀: 공휴일로 밀린 월요일분은 다음 영업일(8/18 화) 시트에 뜬다", () => {
    // 요일만 보고 거르던 시절엔 8/17 에 잘못 떴다가 8/18 엔 사라져 그 주 발송이 통째로 누락됐다.
    expect(names(sheet("2026-08-18", orders, items, slots))).toEqual(["월요일손님"]);
  });

  it("목장 휴무로 그 주가 통째로 막히면 그 주엔 없고 다음 주 같은 요일로 이월된다", () => {
    // 2026 하계휴무(8/10~8/14) — 8/10(월) 회차는 8/17 도 공휴일이라 8/24 로 이월.
    expect(sheet("2026-08-10", orders, items, slots)).toEqual([]);
    expect(names(sheet("2026-08-24", orders, items, slots))).toEqual(["월요일손님"]);
  });
});

describe("buildDispatchSlicesForDate — 단품", () => {
  const DATE = "2026-08-31";
  const once = (over: Partial<O> & { id: string }) =>
    order({ order_type: "단품", block_weeks: 1, ship_date: DATE, status: "입금확인", ...over });

  it("발송예정일이 그날인 단품은 시트에 오른다", () => {
    const o = once({ id: "x", ship_name: "단품손님" });
    expect(names(sheet(DATE, [o], [item({ order_id: "x", delivery_day: null })], []))).toEqual(["단품손님"]);
  });

  it("이미 배송완료된 단품은 작업 목록에서 빠진다(주문 1건 = 발송 1회)", () => {
    const o = once({ id: "x", status: "배송완료" });
    expect(sheet(DATE, [o], [item({ order_id: "x", delivery_day: null })], [])).toEqual([]);
  });

  it("지난 발송일을 넘긴 미출고 단품은 이월분으로 끌어온다(발송일은 원래 예정일 유지)", () => {
    const o = once({ id: "x", ship_date: "2026-08-27", ship_name: "지연손님" });
    const rows = sheet(DATE, [o], [item({ order_id: "x", delivery_day: null })], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].carriedOver).toBe(true);
    expect(rows[0].shipISO).toBe("2026-08-27"); // 회차 이력·재고 차감 키는 원래 발송일
  });
});

describe("buildDispatchSlicesForDate — 한 주문이 두 요일을 구독한 경우", () => {
  // 월·수를 함께 구독하면 슬롯이 요일마다 하나씩(같은 order_id) 생긴다.
  const orders = [order({ id: "o1", block_weeks: 12, ship_name: "두요일손님" })];
  const items = [
    item({ order_id: "o1", delivery_day: "mon", qty: 2 }),
    item({ order_id: "o1", delivery_day: "wed", qty: 3 }),
  ];
  const slots = [
    slot({ id: 1, order_id: "o1", delivery_day: "mon", started_at: "2026-07-06" }),
    slot({ id: 2, order_id: "o1", delivery_day: "wed", started_at: "2026-07-08" }),
  ];

  it("요일마다 한 행씩, 그 요일 품목만 담는다", () => {
    const mon = sheet("2026-08-31", orders, items, slots); // 월
    expect(mon).toHaveLength(1);
    expect(mon[0].day).toBe("mon");
    expect(mon[0].items.map((i) => i.qty)).toEqual([2]);

    const wed = sheet("2026-09-02", orders, items, slots); // 수
    expect(wed).toHaveLength(1);
    expect(wed[0].day).toBe("wed");
    expect(wed[0].items.map((i) => i.qty)).toEqual([3]);
  });

  it("회차는 그 요일 슬롯의 시작일·정지일수로 센다", () => {
    // 수요일 슬롯만 7일 정지 → 수요일분 회차가 한 주 뒤로 밀린다.
    const pausedWed = [
      slots[0],
      { ...slots[1], paused_days: 7 },
    ];
    const mon = sheet("2026-08-31", orders, items, pausedWed);
    const wed = sheet("2026-09-02", orders, items, pausedWed);
    expect(mon[0].round).toBe(8);
    expect(wed[0].round).toBe(7); // 정지 7일만큼 회차가 한 주 밀렸다
  });
});

describe("배송 시트와 기간별 배송 명단은 같은 명단이다", () => {
  it("정기분 집합이 완전히 일치한다(두 화면이 갈리면 과·오배송)", () => {
    const orders = [
      order({ id: "a", status: "배송완료", ship_name: "가" }),
      order({ id: "b", status: "배송중", ship_name: "나" }),
      order({ id: "c", status: "입금확인", ship_name: "다" }),
      order({ id: "d", status: "배송완료", block_weeks: 4, ship_name: "라(소진)" }),
      order({ id: "e", status: "취소", ship_name: "마(취소)" }),
    ];
    const items = ["a", "b", "c", "d", "e"].map((id) => item({ order_id: id }));
    const slots = ["a", "b", "c", "d", "e"].map((id, i) => slot({ id: i + 1, order_id: id }));
    const maps = buildRosterMaps(orders, items, slots);
    const dateISO = "2026-08-31";

    const roster = buildRosterForDate({
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
    const rows = buildDispatchSlicesForDate({
      dateISO,
      orders,
      items,
      itemsByOrder: maps.itemsByOrder,
      maps,
    });

    expect(names(rows)).toEqual(roster.filter((e) => e.kind === "정기").map((e) => e.order.ship_name).sort());
    expect(names(rows)).toEqual(["가", "나", "다"]);
  });
});

describe("buildDispatchSlicesAll — 날짜 필터 해제", () => {
  it("진행 중 구독은 배송완료 주문도 남고, 회차소진·해지는 빠진다", () => {
    const orders = [
      order({ id: "live", status: "배송완료", ship_name: "진행중" }),
      order({ id: "used", status: "배송완료", block_weeks: 4, ship_name: "소진" }),
      order({ id: "gone", status: "배송완료", ship_name: "해지" }),
    ];
    const items = [item({ order_id: "live" }), item({ order_id: "used" }), item({ order_id: "gone" })];
    const slots = [
      slot({ id: 1, order_id: "live" }),
      slot({ id: 2, order_id: "used" }),
      slot({ id: 3, order_id: "gone", status: "해지" }),
    ];
    const maps = buildRosterMaps(orders, items, slots);
    const rows = buildDispatchSlicesAll({
      asOfISO: "2026-08-31",
      orders,
      itemsByOrder: maps.itemsByOrder,
      maps,
    });
    expect(names(rows)).toEqual(["진행중"]);
  });
});
