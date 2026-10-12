// 확정된 회차가 '실제 배송 명단'까지 닿는지 — 이 연결이 끊기면 확정 화면은 장식이다.
//
//   사장님이 "이 손님은 10회 나갔다"고 확정해도, 배송 명단이 달력으로 판정하면
//   달력상 종료일이 지난 순간 그 손님은 명단에서 사라진다. 결제한 14회는 그대로 둔 채로.
import { describe, it, expect } from "vitest";
import {
  buildRosterForDate,
  type RosterOrderFields,
  type RosterItemFields,
} from "./delivery-roster";
import type { DispatchSlotInfo } from "./dispatch-schedule";
import type { RawBlock } from "./subscription-timeline";
import { shippedRoundsBySlot, type RoundBaseline } from "./round-baseline";

const ORDER_ID = "o1";
const SLOT_ID = 7;

function slot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
  return {
    status: "활성",
    started_at: "2026-06-01", // 월요일
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    ...over,
  };
}

// 4주 구독(06-01 시작) 발송일: 06-01 · 06-08 · 06-15 · 06-22(마지막).
const order: RosterOrderFields = {
  id: ORDER_ID,
  order_type: "구독",
  block_weeks: 4,
  ship_date: null,
  ship_name: "박재우",
};
const items: RosterItemFields[] = [
  { order_id: ORDER_ID, product_name: "송영신우유", volume: "900ml", delivery_day: "mon", qty: 1 },
];

function roster(dateISO: string, shippedBySlot?: ReadonlyMap<number, number | null>) {
  return buildRosterForDate({
    dateISO,
    items,
    orderById: new Map([[ORDER_ID, order]]),
    slotByOrder: new Map([[ORDER_ID, slot()]]),
    slotById: new Map([[SLOT_ID, slot()]]),
    slotIdByOrder: new Map([[ORDER_ID, SLOT_ID]]),
    confirmedOrderIds: new Set([ORDER_ID]),
    pausedOrderIds: new Set<string>(),
    shippedBySlot,
  });
}

// 달력상 마지막 발송일(06-22)이 지난 월요일. 여기서 명단에 남는지가 전부다.
const AFTER_CALENDAR_END = "2026-06-29";

describe("확정 회차가 배송 명단까지 닿는다", () => {
  it("미확정이면 지금까지와 똑같다 — 달력 종료일이 지나면 명단에서 빠진다", () => {
    expect(roster("2026-06-15")).toHaveLength(1);
    expect(roster(AFTER_CALENDAR_END)).toHaveLength(0);
  });

  // ★ 이 테스트가 이 PR 의 전부다.
  //   4회 결제 · 2회만 발송된 손님. 달력은 끝났다고 하지만 2회가 남아 있다.
  it("확정된 구독은 결제분을 다 보낼 때까지 명단에 남는다", () => {
    const shipped = new Map<number, number | null>([[SLOT_ID, 2]]);
    expect(roster(AFTER_CALENDAR_END, shipped)).toHaveLength(1);
  });

  // 반대 방향 — 다 보낸 뒤에도 계속 나가면 과배송이고, 그건 돈이 나가는 쪽이다.
  it("결제분을 다 보냈으면 달력이 남아 있어도 명단에서 빠진다", () => {
    const shipped = new Map<number, number | null>([[SLOT_ID, 4]]);
    expect(roster("2026-06-15", shipped)).toHaveLength(0);
  });

  // 맵에 없는 슬롯을 0 으로 읽으면 '한 번도 안 나갔다'가 되어, 이미 다 받은 손님에게
  //   처음부터 다시 보낸다. '모름(null)'과 '0회'는 전혀 다른 값이다.
  it("맵에 없는 슬롯을 0회로 오해하지 않는다", () => {
    const other = new Map<number, number | null>([[999, 0]]);
    expect(roster(AFTER_CALENDAR_END, other)).toHaveLength(0); // 옛 경로 = 소진
  });

  it("명시적 null 도 '모름'으로 다룬다", () => {
    const unknown = new Map<number, number | null>([[SLOT_ID, null]]);
    expect(roster(AFTER_CALENDAR_END, unknown)).toHaveLength(0);
  });
});

describe("shippedRoundsBySlot — 화면이 들고 있는 것만으로 발송 수를 만든다", () => {
  const slotIdByOrder = new Map([
    [ORDER_ID, SLOT_ID],
    ["renew1", SLOT_ID], // 연장주문도 같은 슬롯
  ]);
  const base = (over: Partial<RoundBaseline> = {}): RoundBaseline => ({
    confirmedCount: 5,
    confirmedAt: "2026-09-01",
    ...over,
  });

  it("확정값에 확정일 이후 출고를 더한다", () => {
    const keys = [`${ORDER_ID}|2026-09-08`, `${ORDER_ID}|2026-09-15`];
    const out = shippedRoundsBySlot(keys, slotIdByOrder, new Map([[SLOT_ID, base()]]));
    expect(out.get(SLOT_ID)).toBe(7);
  });

  // 연장주문 출고가 빠지면 재구독한 손님의 회차가 모자라 보이고, 다 보낸 뒤에도 계속 나간다.
  it("연장주문 출고도 같은 슬롯으로 센다", () => {
    const keys = [`${ORDER_ID}|2026-09-08`, `renew1|2026-09-15`];
    const out = shippedRoundsBySlot(keys, slotIdByOrder, new Map([[SLOT_ID, base()]]));
    expect(out.get(SLOT_ID)).toBe(7);
  });

  // 한 날짜 = 한 회차. 같은 날 원주문·연장주문을 둘 다 출고해도 한 회차다.
  it("같은 날 출고는 한 회차로 센다", () => {
    const keys = [`${ORDER_ID}|2026-09-08`, `renew1|2026-09-08`];
    const out = shippedRoundsBySlot(keys, slotIdByOrder, new Map([[SLOT_ID, base()]]));
    expect(out.get(SLOT_ID)).toBe(6);
  });

  it("확정일 이전 출고는 이미 확정값에 들어 있다 — 또 더하지 않는다", () => {
    const keys = [`${ORDER_ID}|2026-08-25`, `${ORDER_ID}|2026-09-01`];
    const out = shippedRoundsBySlot(keys, slotIdByOrder, new Map([[SLOT_ID, base()]]));
    expect(out.get(SLOT_ID)).toBe(5);
  });

  // ★ 미확정 슬롯이 결과에 끼면 호출처가 그 값을 믿고 판정한다. 아예 넣지 않는다.
  it("확정되지 않은 슬롯은 결과에 넣지 않는다", () => {
    const out = shippedRoundsBySlot([`${ORDER_ID}|2026-09-08`], slotIdByOrder, new Map());
    expect(out.has(SLOT_ID)).toBe(false);
    expect(out.size).toBe(0);
  });

  it("슬롯에 닿지 않는 출고 키는 무시한다", () => {
    const keys = ["모르는주문|2026-09-08", "형식이없는키"];
    const out = shippedRoundsBySlot(keys, slotIdByOrder, new Map([[SLOT_ID, base()]]));
    expect(out.get(SLOT_ID)).toBe(5);
  });
});

// ── 블록 체인(원주문 + 재구독 연장주문) 경로 ──────────────────────────────
//   박재우 님이 실제로 지난 길이다. 폴백이 아니라 activeBlockOrderForDate 가 판정하며,
//   여기서 회차를 잘못 세면 '그날 보낼 블록'을 잘못 골라 중간 회차가 통째로 건너뛰어진다.
describe("재구독으로 블록이 이어진 구독", () => {
  const RENEW_ID = "o2";
  // 4주 원주문 + 4주 연장 = 8회차. 발송일 06-01 … 07-20.
  const milk = { productName: "송영신우유", volume: "900ml", qty: 1, unitPrice: 9000 };
  const blocks: RawBlock[] = [
    { orderId: ORDER_ID, weeks: 4, deliveryDay: "mon", shippingPerWeek: 0, creditKrw: 0, items: [milk] },
    { orderId: RENEW_ID, weeks: 4, deliveryDay: "mon", shippingPerWeek: 0, creditKrw: 0, items: [milk] },
  ];
  const renewOrder: RosterOrderFields = { ...order, id: RENEW_ID, renews_slot_id: SLOT_ID };
  const chainItems: RosterItemFields[] = [
    ...items,
    { order_id: RENEW_ID, product_name: "송영신우유", volume: "900ml", delivery_day: "mon", qty: 1 },
  ];

  function chainRoster(dateISO: string, shippedBySlot?: ReadonlyMap<number, number | null>) {
    return buildRosterForDate({
      dateISO,
      items: chainItems,
      orderById: new Map([
        [ORDER_ID, order],
        [RENEW_ID, renewOrder],
      ]),
      slotByOrder: new Map([[ORDER_ID, slot({ extended_weeks: 4 })]]),
      slotById: new Map([[SLOT_ID, slot({ extended_weeks: 4 })]]),
      slotIdByOrder: new Map([
        [ORDER_ID, SLOT_ID],
        [RENEW_ID, SLOT_ID],
      ]),
      blocksBySlot: new Map([[SLOT_ID, blocks]]),
      confirmedOrderIds: new Set([ORDER_ID, RENEW_ID]),
      pausedOrderIds: new Set<string>(),
      shippedBySlot,
    });
  }

  // 한 슬롯에 두 블록이 있어도 그날 나가는 건 언제나 한 건이다(중복 발송 방지).
  it("한 날짜에 한 건만 나간다", () => {
    expect(chainRoster("2026-06-15")).toHaveLength(1);
  });

  // ★ 박재우 사고의 핵심. 3회차까지만 나갔는데 달력은 6회차라고 한다.
  //   달력을 믿으면 6회차가 속한 연장 블록으로 건너뛰고, 4~5회차는 영영 나가지 않는다.
  it("확정 회차로 '이번에 나갈 블록'을 고른다 — 중간 회차를 건너뛰지 않는다", () => {
    const shipped = new Map<number, number | null>([[SLOT_ID, 3]]);
    const got = chainRoster("2026-07-06", shipped); // 달력으론 6회차 자리
    expect(got).toHaveLength(1);
    expect(got[0].order.id).toBe(ORDER_ID); // 4회차 → 아직 원주문 블록
  });

  it("같은 날도 미확정이면 달력대로 연장 블록이 나간다 — 옛 동작 유지", () => {
    const got = chainRoster("2026-07-06");
    expect(got).toHaveLength(1);
    expect(got[0].order.id).toBe(RENEW_ID);
  });

  it("8회를 다 보냈으면 더 나가지 않는다", () => {
    const shipped = new Map<number, number | null>([[SLOT_ID, 8]]);
    expect(chainRoster("2026-07-06", shipped)).toHaveLength(0);
  });
});
