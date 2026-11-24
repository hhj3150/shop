// '내일 발송' 예고 문자도 확정 회차로 센다 (2026-11-24).
//
//   관리자 배송판은 '확정 회차 + 그 뒤 출고 기록'으로 이번에 나갈 회차를 세는데, 예고 문자는
//   달력으로만 셌다. 그래서 문자와 실제 상자가 어긋났다:
//     · 김두혜 님(슬롯 67) — 12회를 다 받았는데 시작일이 옮겨져 달력은 6회가 남았다고 봤다.
//       그대로면 "내일 발송 예정" 문자만 가고 상자는 가지 않는다.
//     · 박재우 님(슬롯 7) — 연장 입금이 늦어 달력이 먼저 끝났다. 상자는 가는데 문자가 없다.
//   여기서는 ① 확정 회차가 예고 대상을 정하고 ② 예고 대상이 배송판 행과 '같다'는 것을 고정한다.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReminderTargets,
  type ReminderItem,
  type ReminderOrder,
  type ReminderShipment,
  type ReminderSlot,
} from "./ship-reminder";
import { buildRosterMaps } from "./roster-maps";
import { buildDispatchSlicesForDate } from "./dispatch-queue";
import { shippedRoundsBeforeBySlot, type RoundBaseline } from "./round-baseline";
import type { DeliveryDay } from "./cart";

// 2026년 11~12월 수요일(공휴일 없음): 11/04 · 11/11 · 11/18 · 11/25 · 12/02 · 12/09
const START = "2026-11-04";
const DEC2 = "2026-12-02";
const CONFIRMED_AT = "2026-11-24";

function order(id: string, over: Partial<ReminderOrder> = {}): ReminderOrder {
  return {
    id,
    order_no: `NO-${id}`,
    status: "배송중",
    order_type: "구독",
    block_weeks: 4,
    shipping_fee: 0,
    created_at: "2026-11-01T00:00:00Z",
    ship_date: null,
    ship_name: `손님${id}`,
    ship_phone: "01000000000",
    delivery_method: "택배",
    renews_slot_id: null,
    is_gift: false,
    gifter_name: null,
    shipped_at: null,
    tracking_no: null,
    ...over,
  };
}
function slot(id: number, orderId: string, over: Partial<ReminderSlot> = {}): ReminderSlot {
  return {
    id,
    order_id: orderId,
    status: "활성",
    started_at: START,
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    delivery_day: "wed",
    rounds_confirmed_count: null,
    rounds_confirmed_at: null,
    ...over,
  };
}
function wed(orderId: string): ReminderItem {
  return {
    order_id: orderId,
    product_name: "우유",
    volume: "750ml",
    delivery_day: "wed" as DeliveryDay,
    qty: 1,
    unit_price: 5000,
  };
}
function targetIds(input: {
  orders: ReminderOrder[];
  slots: ReminderSlot[];
  shipments?: ReminderShipment[];
  dateISO?: string;
}): string[] {
  return buildReminderTargets({
    dateISO: input.dateISO ?? DEC2,
    orders: input.orders,
    items: input.orders.map((o) => wed(o.id)),
    slots: input.slots,
    remindedOrderIds: new Set(),
    shipments: input.shipments,
  })
    .map((t) => t.orderId)
    .sort();
}

describe("예고 문자 — 확정 회차가 대상을 정한다", () => {
  // 4회 구독, 달력으로는 11/25 가 마지막이라 12/02 예고가 없다.
  it("[상자는 가는데 문자가 없던 경우] 달력은 끝났어도 확정 회차가 남았으면 예고한다", () => {
    const orders = [order("A")];
    expect(targetIds({ orders, slots: [slot(1, "A")] })).toEqual([]); // 옛 동작(달력)
    expect(
      targetIds({
        orders,
        slots: [slot(1, "A", { rounds_confirmed_count: 2, rounds_confirmed_at: CONFIRMED_AT })],
      })
    ).toEqual(["A"]);
  });

  // 8회 구독, 달력으로는 12/02 가 5회차라 예고가 나간다.
  it("[문자만 가고 상자가 없던 경우] 달력은 남았어도 결제 회차를 다 받았으면 예고하지 않는다", () => {
    const orders = [order("B", { block_weeks: 8 })];
    expect(targetIds({ orders, slots: [slot(2, "B")] })).toEqual(["B"]); // 옛 동작(달력)
    expect(
      targetIds({
        orders,
        slots: [slot(2, "B", { rounds_confirmed_count: 8, rounds_confirmed_at: CONFIRMED_AT })],
      })
    ).toEqual([]);
  });

  it("확정일 뒤의 출고 기록을 더해 센다 — 마지막 회차가 나갔으면 다음 주 예고는 없다", () => {
    const orders = [order("C")];
    const slots = [slot(3, "C", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT })];
    // 3회 확정, 그 뒤 기록 없음 → 12/02 는 4회차(마지막) → 예고.
    expect(targetIds({ orders, slots })).toEqual(["C"]);
    // 11/25 에 4회차가 나갔다 → 12/02 는 보낼 회차가 없다.
    expect(
      targetIds({ orders, slots, shipments: [{ order_id: "C", ship_date: "2026-11-25" }] })
    ).toEqual([]);
  });

  it("예고 대상일 당일의 출고 기록은 세지 않는다(그날 회차 자신이다)", () => {
    const orders = [order("C")];
    const slots = [slot(3, "C", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT })];
    expect(
      targetIds({ orders, slots, shipments: [{ order_id: "C", ship_date: DEC2 }] })
    ).toEqual(["C"]);
  });

  // 원주문 4회 + 연장 4회. 달력은 12/02 를 5회차(연장분)로 보지만, 실제로는 3회만 나갔다.
  it("연장 구독 — 기록 기준 회차의 블록(원주문/연장분) 주문으로 예고한다", () => {
    const orders = [
      order("O"),
      order("R", { renews_slot_id: 5, created_at: "2026-11-20T00:00:00Z" }),
    ];
    expect(targetIds({ orders, slots: [slot(5, "O")] })).toEqual(["R"]); // 달력: 5회차 = 연장분
    const confirmed = [slot(5, "O", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT })];
    expect(targetIds({ orders, slots: confirmed })).toEqual(["O"]); // 기록: 4회차 = 원주문 마지막
    // 연장주문으로 나간 기록도 같은 구독의 회차로 센다.
    expect(
      targetIds({
        orders,
        slots: confirmed,
        shipments: [{ order_id: "O", ship_date: "2026-11-25" }],
      })
    ).toEqual(["R"]);
  });

  it("확정일이 예고 대상일과 같거나 뒤면 그 날짜의 진행도는 모른다 → 달력으로 판정한다", () => {
    const orders = [order("B", { block_weeks: 8 })];
    expect(
      targetIds({
        orders,
        slots: [slot(2, "B", { rounds_confirmed_count: 8, rounds_confirmed_at: DEC2 })],
      })
    ).toEqual(["B"]);
  });

  it("확정 정보가 없는 옛 dataset 은 지금까지와 똑같이 동작한다", () => {
    const legacy = (id: number, orderId: string): ReminderSlot => {
      const s = slot(id, orderId);
      delete s.delivery_day;
      delete s.rounds_confirmed_count;
      delete s.rounds_confirmed_at;
      return s;
    };
    expect(
      targetIds({ orders: [order("A"), order("B", { block_weeks: 8 })], slots: [legacy(1, "A"), legacy(2, "B")] })
    ).toEqual(["B"]);
  });
});

describe("예고 대상 = 관리자 배송판 행", () => {
  // 한 날짜에 여러 경우를 섞는다. 같은 입력이면 문자 받는 손님과 배송판 행이 같아야 한다.
  const orders: ReminderOrder[] = [
    order("A"), // 달력 종료 · 확정 2회 → 남음
    order("B", { block_weeks: 8 }), // 달력 진행 · 확정 8회 → 끝
    order("C"), // 확정 3회 + 11/25 출고 → 끝
    order("D"), // 확정 3회 → 4회차
    order("O"), // 연장 구독 원주문
    order("R", { renews_slot_id: 5, created_at: "2026-11-20T00:00:00Z" }),
    order("U", { block_weeks: 8 }), // 미확정 → 달력
    order("P", { block_weeks: 8, delivery_method: "방문수령" }), // 방문수령 → 둘 다 제외
  ];
  const slots: ReminderSlot[] = [
    slot(1, "A", { rounds_confirmed_count: 2, rounds_confirmed_at: CONFIRMED_AT }),
    slot(2, "B", { rounds_confirmed_count: 8, rounds_confirmed_at: CONFIRMED_AT }),
    slot(3, "C", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT }),
    slot(4, "D", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT }),
    slot(5, "O", { rounds_confirmed_count: 3, rounds_confirmed_at: CONFIRMED_AT }),
    slot(6, "U"),
    slot(7, "P", { rounds_confirmed_count: 2, rounds_confirmed_at: CONFIRMED_AT }),
  ];
  const items = orders.map((o) => wed(o.id));
  const shipments: ReminderShipment[] = [
    { order_id: "C", ship_date: "2026-11-25" },
    { order_id: "O", ship_date: "2026-11-25" },
  ];

  function sheetIds(dateISO: string): string[] {
    const maps = buildRosterMaps(orders, items, slots);
    const keys = new Map<string, string | null>(
      shipments.map((s) => [`${s.order_id}|${s.ship_date}`, null])
    );
    const baselines = new Map<number, RoundBaseline>();
    for (const s of slots) {
      if (s.rounds_confirmed_count == null || !s.rounds_confirmed_at) continue;
      baselines.set(s.id, { confirmedCount: s.rounds_confirmed_count, confirmedAt: s.rounds_confirmed_at });
    }
    return buildDispatchSlicesForDate({
      dateISO,
      orders,
      items,
      itemsByOrder: maps.itemsByOrder,
      maps: {
        ...maps,
        shippedKeys: keys,
        shippedBefore: shippedRoundsBeforeBySlot(keys.keys(), maps.slotIdByOrder, baselines),
      },
    })
      .filter((r) => r.kind === "정기")
      .map((r) => r.order.id)
      .sort();
  }

  it.each([DEC2, "2026-12-09", "2026-12-16"])("%s — 문자 받는 손님과 배송판 행이 같다", (dateISO) => {
    const reminded = buildReminderTargets({
      dateISO,
      orders,
      items,
      slots,
      remindedOrderIds: new Set(),
      shipments,
    })
      .map((t) => t.orderId)
      .sort();
    expect(reminded).toEqual(sheetIds(dateISO));
  });

  it("12/02 에 실제로 갈리는 경우들이 들어 있다(검증이 비어 있지 않다)", () => {
    expect(sheetIds(DEC2)).toEqual(["A", "D", "R", "U"]);
  });
});

// 운영 DB 에 적용한 정의를 저장소에서 고정한다(다음 마이그레이션에서 조용히 빠지지 않게).
describe("ship_reminder_dataset — 확정 회차 입력을 돌려준다", () => {
  const sql = readFileSync(
    join(__dirname, "..", "supabase/migration-ship-reminder-confirmed-rounds.sql"),
    "utf8"
  );
  const start = sql.indexOf("create or replace function public.ship_reminder_dataset(");
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const fn = readFileSync(join(__dirname, "..", "netlify/functions/ship-reminder.mts"), "utf8");

  it("slots 에 요일과 확정 기준점이 있다", () => {
    expect(body).toMatch(/'delivery_day', s\.delivery_day/);
    expect(body).toMatch(/'rounds_confirmed_count', s\.rounds_confirmed_count/);
    expect(body).toMatch(/'rounds_confirmed_at', s\.rounds_confirmed_at/);
  });

  it("shipments 는 확정된 구독의 '확정일 뒤 · 대상일 전' 기록만, 원주문·연장주문 모두", () => {
    expect(body).toMatch(/'shipments', coalesce\(/);
    expect(body).toMatch(/s\.order_id = o\.id or s\.id = o\.renews_slot_id/);
    expect(body).toMatch(/sl\.ship_date > s\.rounds_confirmed_at/);
    expect(body).toMatch(/sl\.ship_date < p_ship_date/);
  });

  it("시크릿 검사와 기존 키는 그대로다", () => {
    expect(body).toMatch(/p_secret <> v_expected/);
    for (const key of ["'orders'", "'items'", "'slots'", "'reminded'", "'dispatched'", "'reschedules'"]) {
      expect(body).toContain(key);
    }
  });

  it("예약 함수가 shipments 를 넘긴다", () => {
    expect(fn).toMatch(/shipments: ds\.shipments \?\? \[\]/);
  });
});
