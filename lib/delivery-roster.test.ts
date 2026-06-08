import { describe, it, expect } from "vitest";
import {
  buildRosterForDate,
  compositionSignature,
  type RosterOrderFields,
  type RosterItemFields,
} from "./delivery-roster";
import type { DispatchSlotInfo } from "./dispatch-schedule";
import type { RawBlock } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// ── 테스트 픽스처 헬퍼 ──
function order(over: Partial<RosterOrderFields> & { id: string }): RosterOrderFields {
  return {
    order_type: "구독",
    block_weeks: 4,
    ship_date: null,
    ship_name: "홍길동",
    ...over,
  };
}
function item(over: Partial<RosterItemFields> & { order_id: string }): RosterItemFields {
  return {
    product_name: "송영신우유",
    volume: "180ml",
    delivery_day: "mon",
    qty: 1,
    ...over,
  };
}
function slot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
  return {
    status: "활성",
    started_at: "2026-06-01",
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    ...over,
  };
}

// 4주 구독(2026-06-01 시작) 발송일: 06-01, 06-08, 06-15, 06-22(마지막).
const DATE = "2026-06-15"; // 명단 발송일(월요일분, 3회차 — 마지막 아님)
const AFTER_END_DATE = "2026-06-29"; // 마지막 발송일(06-22) 이후의 월요일 → 회차소진
const WD = "mon" as const;

function build(opts: {
  orders: RosterOrderFields[];
  items: RosterItemFields[];
  slots?: Map<string, DispatchSlotInfo>;
  confirmed?: Set<string>;
  paused?: Set<string>;
  dateISO?: string;
  weekday?: DeliveryDay | null;
  blocksBySlot?: Map<number, RawBlock[]>;
  slotIdByOrder?: Map<string, number>;
}) {
  return buildRosterForDate({
    dateISO: opts.dateISO ?? DATE,
    weekday: opts.weekday ?? WD,
    items: opts.items,
    orderById: new Map(opts.orders.map((o) => [o.id, o])),
    slotByOrder: opts.slots ?? new Map(),
    confirmedOrderIds: opts.confirmed ?? new Set(opts.orders.map((o) => o.id)),
    pausedOrderIds: opts.paused ?? new Set(),
    blocksBySlot: opts.blocksBySlot ?? new Map(),
    slotIdByOrder: opts.slotIdByOrder ?? new Map(),
  });
}

describe("buildRosterForDate", () => {
  it("활성 구독은 그 요일 명단에 포함된다", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
    });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("정기");
    expect(r[0].order.id).toBe("o1");
  });

  // ── 회귀 가드: 이 두 케이스가 원래 버그(과배송)였다 ──
  it("해지된 구독은 명단에서 제외된다 (회귀: slot.status='해지')", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot({ status: "해지" })]]),
      // 해지해도 주문 상태는 입금확인으로 남아 confirmed 에 있음 — 그래도 빠져야 한다.
    });
    expect(r).toHaveLength(0);
  });

  it("회차 소진(마지막 발송일 지난 날짜)은 명단에서 제외된다", () => {
    // 마지막 발송일 06-22 이후인 06-29 명단 → 회차소진으로 제외.
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      dateISO: AFTER_END_DATE,
    });
    expect(r).toHaveLength(0);
  });

  it("마지막 회차 발송일 당일은 명단에 포함된다 (회귀: 마지막 회차 누락 방지)", () => {
    // 마지막 발송일 06-22 당일 — 그날 실제 발송하므로 빠지면 안 된다.
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      dateISO: "2026-06-22",
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o1");
  });

  it("일시정지 구독(pausedOrderIds)은 제외된다", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      paused: new Set(["o1"]),
    });
    expect(r).toHaveLength(0);
  });

  it("미래로 지정한 시작일 전 날짜에는 명단에서 제외된다(구독 시작일 연기)", () => {
    // started_at 을 2026-06-22 로 미래 지정 → 그 전 월요일(06-15) 명단엔 안 나온다.
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot({ started_at: "2026-06-22" })]]),
      dateISO: "2026-06-15",
    });
    expect(r).toHaveLength(0);
  });

  it("미확인(confirmed 아님) 주문은 제외된다", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      confirmed: new Set(),
    });
    expect(r).toHaveLength(0);
  });

  it("슬롯이 없는 구독은 보수적으로 포함한다", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map(), // 슬롯 미상
    });
    expect(r).toHaveLength(1);
  });

  it("단품은 ship_date 가 일치할 때만 포함된다", () => {
    const match = order({ id: "once1", order_type: "단품", ship_date: DATE });
    const off = order({ id: "once2", order_type: "단품", ship_date: "2026-06-16" });
    const r = build({
      orders: [match, off],
      items: [item({ order_id: "once1" }), item({ order_id: "once2" })],
      weekday: null, // 단품은 요일 무관
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("once1");
    expect(r[0].kind).toBe("단품");
  });

  it("정렬: 정기가 단품보다 먼저 온다", () => {
    const sub = order({ id: "sub" });
    const once = order({ id: "once", order_type: "단품", ship_date: DATE });
    const r = build({
      orders: [sub, once],
      items: [item({ order_id: "sub" }), item({ order_id: "once" })],
      slots: new Map([["sub", slot()]]),
    });
    expect(r.map((e) => e.kind)).toEqual(["정기", "단품"]);
  });
});

// ── 활성 블록 게이팅 (연장주문이 자기 order_items 를 가질 때 이중발송 방지) ──
//   슬롯 시작 2026-06-01(월). 블록0=4주 월(o0·우유), 블록1=4주 화(o1·요거트). 총 8주.
//   블록0 발송일: 06-01,06-08,06-15,06-22(회차1~4).
//   블록1 구간(회차5~8) — 회차5 예정일 06-29(월) 이후. 화요일 발송이므로 06-30(화)에 평가하면 회차5=블록1.
describe("buildRosterForDate — 활성 블록 게이팅", () => {
  function blkSlot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
    return slot({ started_at: "2026-06-01", extended_weeks: 4, ...over });
  }
  // 슬롯 1개(id=10), 원주문 o0(월·우유), 연장주문 o1(화·요거트). 둘 다 4주.
  const block0: RawBlock = {
    orderId: "o0",
    weeks: 4,
    deliveryDay: "mon",
    shippingPerWeek: 4000,
    items: [{ productName: "우유", volume: "180ml", qty: 1, unitPrice: 3000 }],
  };
  const block1: RawBlock = {
    orderId: "o1",
    weeks: 4,
    deliveryDay: "tue",
    shippingPerWeek: 4000,
    items: [{ productName: "요거트", volume: "85g", qty: 2, unitPrice: 2000 }],
  };
  const blocksBySlot = new Map<number, RawBlock[]>([[10, [block0, block1]]]);
  const slotIdByOrder = new Map<string, number>([
    ["o0", 10],
    ["o1", 10],
  ]);
  const orders = [
    order({ id: "o0" }),
    order({ id: "o1", ship_name: "홍길동" }),
  ];
  const items = [
    item({ order_id: "o0", product_name: "우유", volume: "180ml", delivery_day: "mon", qty: 1 }),
    item({ order_id: "o1", product_name: "요거트", volume: "85g", delivery_day: "tue", qty: 2 }),
  ];

  it("블록0 구간 날짜(06-15 월)엔 블록0 items만 발송, 블록1 미발송", () => {
    const r = build({
      orders,
      items,
      slots: new Map([["o0", blkSlot()], ["o1", blkSlot()]]),
      blocksBySlot,
      slotIdByOrder,
      dateISO: "2026-06-15",
      weekday: "mon",
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o0");
    expect(r[0].items.map((i) => i.product_name)).toEqual(["우유"]);
  });

  it("블록1 구간 날짜(06-30 화)엔 블록1 items만 발송, 블록0 미발송(이중발송 0)", () => {
    const r = build({
      orders,
      items,
      slots: new Map([["o0", blkSlot()], ["o1", blkSlot()]]),
      blocksBySlot,
      slotIdByOrder,
      dateISO: "2026-06-30",
      weekday: "tue",
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o1");
    expect(r[0].items.map((i) => i.product_name)).toEqual(["요거트"]);
  });

  it("블록1 구간(화요일)에 블록0 요일(월)을 조회하면 아무것도 발송 안 함", () => {
    // 06-30 주의 월요일 분(블록0 요일)이지만 활성 블록은 블록1 → 블록0 미발송.
    const r = build({
      orders,
      items,
      slots: new Map([["o0", blkSlot()], ["o1", blkSlot()]]),
      blocksBySlot,
      slotIdByOrder,
      dateISO: "2026-06-29",
      weekday: "mon",
    });
    expect(r).toHaveLength(0);
  });

  it("같은 요일(월) 두 블록이 구성만 다를 때, 블록1 구간엔 블록1 items만(이중발송 0)", () => {
    // 핵심 회귀: 블록0·블록1 모두 월요일 발송, 품목만 변경. 게이팅 없으면 둘 다 나와 이중발송.
    const b0Mon: RawBlock = { ...block0, deliveryDay: "mon" };
    const b1Mon: RawBlock = { ...block1, deliveryDay: "mon" };
    const r = build({
      orders: [order({ id: "o0" }), order({ id: "o1" })],
      items: [
        item({ order_id: "o0", product_name: "우유", volume: "180ml", delivery_day: "mon", qty: 1 }),
        item({ order_id: "o1", product_name: "요거트", volume: "85g", delivery_day: "mon", qty: 2 }),
      ],
      slots: new Map([["o0", blkSlot()], ["o1", blkSlot()]]),
      blocksBySlot: new Map<number, RawBlock[]>([[10, [b0Mon, b1Mon]]]),
      slotIdByOrder,
      dateISO: "2026-07-06", // 회차6(블록1 구간) 월요일
      weekday: "mon",
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o1");
    expect(r[0].items.map((i) => i.product_name)).toEqual(["요거트"]);
  });

  it("소진 후(8회 모두 지난) 날짜는 활성 블록 없음 → 미발송", () => {
    // 마지막 회차8 예정일 = 06-01 + 7*7 = 07-20(월). 그 이후 화요일 07-28.
    const r = build({
      orders,
      items,
      slots: new Map([["o0", blkSlot()], ["o1", blkSlot()]]),
      blocksBySlot,
      slotIdByOrder,
      dateISO: "2026-07-28",
      weekday: "tue",
    });
    expect(r).toHaveLength(0);
  });

  it("시작 전 날짜는 활성 블록 없음 → 미발송", () => {
    const r = build({
      orders,
      items,
      slots: new Map([["o0", blkSlot({ started_at: "2026-07-01" })], ["o1", blkSlot({ started_at: "2026-07-01" })]]),
      blocksBySlot,
      slotIdByOrder,
      dateISO: "2026-06-15",
      weekday: "mon",
    });
    expect(r).toHaveLength(0);
  });

  it("회귀: blocksBySlot 항목 없는 슬롯은 기존 dispatchScheduleForSlot 폴백으로 포함", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      // blocksBySlot / slotIdByOrder 비움 → 폴백 경로
    });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o1");
  });
});

describe("compositionSignature", () => {
  it("제품·용량·수량을 정렬해 안정적 키를 만든다", () => {
    const a = compositionSignature([
      { product_name: "B우유", volume: "180ml", qty: 1 },
      { product_name: "A우유", volume: "500ml", qty: 2 },
    ]);
    const b = compositionSignature([
      { product_name: "A우유", volume: "500ml", qty: 2 },
      { product_name: "B우유", volume: "180ml", qty: 1 },
    ]);
    expect(a).toBe(b); // 순서 달라도 동일 키
  });
});
