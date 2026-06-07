import { describe, it, expect } from "vitest";
import {
  buildRosterForDate,
  compositionSignature,
  type RosterOrderFields,
  type RosterItemFields,
} from "./delivery-roster";
import type { DispatchSlotInfo } from "./dispatch-schedule";

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

// 4주 구독(2026-06-01 시작) 발송일: 06-01, 06-08, 06-15, 06-22.
const WITHIN = new Date(2026, 5, 10); // 6/10 — 2회차 발송됨, 미완료
const AFTER_END = new Date(2026, 6, 1); // 7/1 — 4회 모두 경과(회차소진)
const DATE = "2026-06-15"; // 명단 발송일(월요일분 가정)
const WD = "mon" as const;

function build(opts: {
  orders: RosterOrderFields[];
  items: RosterItemFields[];
  slots?: Map<string, DispatchSlotInfo>;
  confirmed?: Set<string>;
  paused?: Set<string>;
  today?: Date;
  dateISO?: string;
  weekday?: typeof WD | null;
}) {
  return buildRosterForDate({
    dateISO: opts.dateISO ?? DATE,
    weekday: opts.weekday ?? WD,
    items: opts.items,
    orderById: new Map(opts.orders.map((o) => [o.id, o])),
    slotByOrder: opts.slots ?? new Map(),
    confirmedOrderIds: opts.confirmed ?? new Set(opts.orders.map((o) => o.id)),
    pausedOrderIds: opts.paused ?? new Set(),
    today: opts.today ?? WITHIN,
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

  it("회차 소진 구독은 명단에서 제외된다 (회귀: 모든 회차 발송 완료)", () => {
    const o = order({ id: "o1" });
    const r = build({
      orders: [o],
      items: [item({ order_id: "o1" })],
      slots: new Map([["o1", slot()]]),
      today: AFTER_END, // 4회 모두 경과 → done
    });
    expect(r).toHaveLength(0);
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
