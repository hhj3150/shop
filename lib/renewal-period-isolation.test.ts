// 연장분과 지금 기간이 서로를 건드리지 않는가 — 2026-11-24 윤화영 거래처 회귀 테스트.
//
//   사고: 원주문 12회(8/31 시작, 매주 월) 중 11/23 이 12번째. 11/19 연장 24회 입금 확인 직후,
//   관리자가 연장 주문 행에서 '시작일 변경'을 눌러 슬롯 앵커(started_at)가 11/30 이후로 밀렸다.
//   → 11/23 명단에서 빠지고, 회차가 1/36 부터 다시 셌다.
//
//   여기서는 실제 배송판 계산(buildRosterMaps → buildDispatchSlicesForDate)에 같은 데이터를 넣어
//   ① 앵커가 맞으면 11/23 은 원주문 12번째, 11/30 은 연장분 1번째로 이어지고
//   ② 회차 표기가 기간 기준('12/12회 · 연장 24회 대기' → '연장 1/24회')으로 나오며
//   ③ 앵커가 밀리면 실제로 명단에서 빠진다는 것(= 시작일 잠금이 왜 필요한지)을 고정한다.
import { describe, expect, it } from "vitest";
import { buildDispatchSlicesForDate, roundLabel } from "./dispatch-queue";
import { buildRosterMaps } from "./roster-maps";
import { periodRoundForChainRound } from "./subscription-timeline";
import { shippedRoundsBeforeBySlot, type RoundBaseline } from "./round-baseline";

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

const SLOT = 87;
const ORIG: O = {
  id: "orig",
  status: "배송중",
  order_type: "구독",
  block_weeks: 12,
  shipping_fee: 48000,
  created_at: "2026-08-28T00:14:00Z",
  ship_date: null,
  ship_name: "지금 기간 받는 곳",
  delivery_method: "택배",
  renews_slot_id: null,
  shipped_at: "2026-08-31T07:11:04Z",
};
const RENEW: O = {
  ...ORIG,
  id: "renew",
  status: "입금확인",
  block_weeks: 24,
  shipping_fee: 96000,
  created_at: "2026-11-19T06:45:50Z",
  ship_name: "연장분 받는 곳",
  renews_slot_id: SLOT,
  shipped_at: null,
};
const ITEMS: I[] = [
  { order_id: "orig", product_name: "송영신우유", volume: "750ml", delivery_day: "mon", qty: 3, unit_price: 10200 },
  { order_id: "renew", product_name: "송영신우유", volume: "750ml", delivery_day: "mon", qty: 3, unit_price: 9600 },
];
// 실제 출고 기록(8/31~11/23, 9/21 주는 목장 휴무). 11/23 까지 12회.
const SHIPPED = [
  "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-29", "2026-10-06", "2026-10-12",
  "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23",
];

function slotRow(startedAt: string, confirmed: RoundBaseline | null) {
  return {
    id: SLOT,
    order_id: "orig",
    status: "활성",
    started_at: startedAt,
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 24,
    delivery_day: "mon",
    rounds_confirmed_count: confirmed?.confirmedCount ?? null,
    rounds_confirmed_at: confirmed?.confirmedAt ?? null,
  };
}

function sheet(dateISO: string, startedAt: string, confirmed: RoundBaseline | null) {
  const orders = [ORIG, RENEW];
  const slots = [slotRow(startedAt, confirmed)];
  const maps = buildRosterMaps(orders, ITEMS, slots);
  const keys = new Map(SHIPPED.filter((d) => d < dateISO).map((d) => [`orig|${d}`, null]));
  const baselines = new Map<number, RoundBaseline>(confirmed ? [[SLOT, confirmed]] : []);
  return buildDispatchSlicesForDate({
    dateISO,
    orders,
    items: ITEMS,
    itemsByOrder: maps.itemsByOrder,
    maps: {
      ...maps,
      shippedKeys: keys,
      shippedBefore: shippedRoundsBeforeBySlot(keys.keys(), maps.slotIdByOrder, baselines),
    },
  });
}

describe("periodRoundForChainRound — 체인 회차를 기간 안 회차로", () => {
  const blocks = [
    { orderId: "orig", weeks: 12, deliveryDay: "mon" as const, items: [], shippingPerWeek: 0, creditKrw: 0 },
    { orderId: "renew", weeks: 24, deliveryDay: "mon" as const, items: [], shippingPerWeek: 0, creditKrw: 0 },
  ];
  it("원주문 마지막 회차 = 12/12, 뒤에 24회 대기", () => {
    expect(periodRoundForChainRound(blocks, 12)).toEqual({ periodIndex: 0, round: 12, total: 12, nextWeeks: 24 });
  });
  it("13회차 = 연장 1/24", () => {
    expect(periodRoundForChainRound(blocks, 13)).toEqual({ periodIndex: 1, round: 1, total: 24, nextWeeks: 0 });
  });
  it("범위 밖은 null", () => {
    expect(periodRoundForChainRound(blocks, 0)).toBeNull();
    expect(periodRoundForChainRound(blocks, 37)).toBeNull();
  });
});

describe("roundLabel — 배송판 회차 칸", () => {
  it("연장 없는 구독은 지금과 같다", () => {
    expect(roundLabel({ round: 3, total: 12, period: null })).toBe("3/12회");
    expect(roundLabel({ round: 3, total: 0, period: null })).toBe("3회");
  });
  it("원주문 마지막 회차에 연장 대기를 함께 적는다", () => {
    expect(
      roundLabel({ round: 12, total: 36, period: { periodIndex: 0, round: 12, total: 12, nextWeeks: 24 } })
    ).toBe("12/12회 · 연장 24회 대기");
  });
  it("연장분은 '연장 n/m회'", () => {
    expect(
      roundLabel({ round: 13, total: 36, period: { periodIndex: 1, round: 1, total: 24, nextWeeks: 0 } })
    ).toBe("연장 1/24회");
  });
});

describe("윤화영 거래처 — 연장 확인 뒤에도 지금 기간은 그대로, 연장분은 다음 회차부터", () => {
  const CONFIRMED: RoundBaseline = { confirmedCount: 12, confirmedAt: "2026-11-24" };

  it("앵커가 맞으면(8/31) 11/23 은 원주문 12번째 — 지금 기간 받는 곳으로", () => {
    const rows = sheet("2026-11-23", "2026-08-31", null);
    expect(rows).toHaveLength(1);
    expect(rows[0].order.id).toBe("orig");
    expect(rows[0].order.ship_name).toBe("지금 기간 받는 곳");
    expect(roundLabel(rows[0])).toBe("12/12회 · 연장 24회 대기");
  });

  it("11/30 은 연장분 1번째 — 연장분 자기 받는 곳·품목으로", () => {
    const rows = sheet("2026-11-30", "2026-08-31", CONFIRMED);
    expect(rows).toHaveLength(1);
    expect(rows[0].order.id).toBe("renew");
    expect(rows[0].order.ship_name).toBe("연장분 받는 곳");
    expect(rows[0].items.map((i) => i.unit_price)).toEqual([9600]);
    expect(roundLabel(rows[0])).toBe("연장 1/24회");
  });

  // 시작일 잠금이 막는 바로 그 사고. 앵커를 11/30 으로 밀면 11/23 명단에서 사라진다.
  it("[사고 재현] 연장 행에서 시작일을 11/30 으로 밀면 11/23 에서 빠진다", () => {
    expect(sheet("2026-11-23", "2026-11-30", null)).toHaveLength(0);
  });

  it("회차를 확정해 두면 앵커가 틀려도(9/14) 11/30 은 연장분 1번째다", () => {
    const rows = sheet("2026-11-30", "2026-09-14", CONFIRMED);
    expect(rows.map((r) => r.order.id)).toEqual(["renew"]);
    expect(roundLabel(rows[0])).toBe("연장 1/24회");
  });
});
