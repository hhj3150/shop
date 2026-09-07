import { describe, it, expect } from "vitest";
import {
  cancelledButActiveSlots,
  paidRoundsForSlot,
  roundsUsedUpSlots,
  shipmentGapSlots,
  SHIPMENT_GAP_THRESHOLD,
} from "./slot-integrity";
import type { RawBlock } from "./subscription-timeline";

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
};
type O = { id: string; status: string; block_weeks: number | null };

function slot(over: Partial<S> & { id: number }): S {
  return {
    order_id: `ord-${over.id}`,
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
function order(over: Partial<O> & { id: string }): O {
  return { status: "입금확인", block_weeks: 12, ...over };
}
const byId = (rows: O[]) => new Map(rows.map((o) => [o.id, o]));

// 회차만 중요한 블록(품목·배송비는 이 판정에 쓰이지 않는다).
function block(orderId: string, weeks: number): RawBlock {
  return { orderId, weeks, shippingPerWeek: 0, items: [], deliveryDay: null };
}

describe("paidRoundsForSlot — 결제 회차의 단일 기준", () => {
  it("블록 체인이 있으면 그 합을 쓴다(extended_weeks 무시)", () => {
    const s = slot({ id: 1, extended_weeks: 8 });
    const blocks = new Map([[1, [block("ord-1", 12)]]]);
    expect(paidRoundsForSlot(s, byId([order({ id: "ord-1" })]), blocks)).toBe(12);
  });

  it("확정 연장주문이 있으면 체인 합에 더해진다", () => {
    const s = slot({ id: 1, extended_weeks: 0 });
    const blocks = new Map([[1, [block("ord-1", 12), block("ord-r", 8)]]]);
    expect(paidRoundsForSlot(s, byId([order({ id: "ord-1" })]), blocks)).toBe(20);
  });

  it("블록이 없으면(레거시) block_weeks + extended_weeks 로 폴백", () => {
    const s = slot({ id: 1, extended_weeks: 8 });
    expect(paidRoundsForSlot(s, byId([order({ id: "ord-1" })]))).toBe(20);
  });
});

describe("cancelledButActiveSlots — 취소 주문인데 살아 있는 좌석", () => {
  it("★회귀: 주문이 '취소'인데 슬롯이 활성이면 잡아낸다", () => {
    // 손님 마이페이지에는 구독과 '다음 발송일'이 계속 뜨는데 배송 명단에는 없다.
    //   요일 정원도 계속 차지해 신규 신청을 막는다(실제로 3주간 방치된 좌석이 있었다).
    const slots = [slot({ id: 1 }), slot({ id: 2 })];
    const orders = byId([
      order({ id: "ord-1", status: "취소" }),
      order({ id: "ord-2", status: "입금확인" }),
    ]);
    expect(cancelledButActiveSlots(slots, orders).map((s) => s.id)).toEqual([1]);
  });

  it("'신청'·'대기' 좌석도 잡는다 — 자리를 차지하는 것은 같다", () => {
    const slots = [slot({ id: 1, status: "신청" }), slot({ id: 2, status: "대기" })];
    const orders = byId([
      order({ id: "ord-1", status: "취소" }),
      order({ id: "ord-2", status: "취소" }),
    ]);
    expect(cancelledButActiveSlots(slots, orders)).toHaveLength(2);
  });

  it("이미 해지된 좌석은 정상이므로 잡지 않는다", () => {
    const slots = [slot({ id: 1, status: "해지" })];
    expect(cancelledButActiveSlots(slots, byId([order({ id: "ord-1", status: "취소" })]))).toEqual([]);
  });
});

describe("roundsUsedUpSlots — 결제 회차 소진", () => {
  const orders = byId([order({ id: "ord-1", block_weeks: 12 })]);

  it("발송 이력이 결제 회차에 도달하면 잡는다", () => {
    const s = slot({ id: 1 });
    const blocks = new Map([[1, [block("ord-1", 12)]]]);
    const got = roundsUsedUpSlots([s], orders, new Map([[1, 12]]), blocks);
    expect(got).toHaveLength(1);
    expect(got[0].paid).toBe(12);
  });

  it("아직 남았으면 잡지 않는다", () => {
    const blocks = new Map([[1, [block("ord-1", 12)]]]);
    expect(roundsUsedUpSlots([slot({ id: 1 })], orders, new Map([[1, 11]]), blocks)).toEqual([]);
  });

  it("★회귀: 취소된 연장의 extended_weeks 잔재로 소진을 놓치지 않는다", () => {
    // 옛 계산(block_weeks + extended_weeks = 20)이면 12회를 다 보낸 구독이 '아직 8회 남음'으로
    //   보여 경고가 뜨지 않고, 배송 시트도 계속 내보낸다 → 과배송.
    const s = slot({ id: 1, extended_weeks: 8 }); // 연장은 취소돼 체인엔 없다
    const blocks = new Map([[1, [block("ord-1", 12)]]]);
    expect(roundsUsedUpSlots([s], orders, new Map([[1, 12]]), blocks)).toHaveLength(1);
  });

  it("해지·정지 대기 등 비활성 슬롯은 대상이 아니다", () => {
    const blocks = new Map([[1, [block("ord-1", 12)]]]);
    expect(
      roundsUsedUpSlots([slot({ id: 1, status: "해지" })], orders, new Map([[1, 12]]), blocks)
    ).toEqual([]);
  });
});

describe("shipmentGapSlots — 출고 기록이 실제를 못 따라가는 구독", () => {
  const orders = byId([order({ id: "ord-1", block_weeks: 12 })]);
  const blocks = new Map([[1, [block("ord-1", 12)]]]);
  // 2026-06-01(월) 시작 12주 구독을 2026-08-31(월)에 본다 → 모델상 여러 회차가 이미 지났다.
  const TODAY = "2026-08-31";

  it("★기록이 비어 있으면 잡아낸다 — 과배송 방어선이 이 기록을 센다", () => {
    const got = shipmentGapSlots([slot({ id: 1 })], orders, new Map(), TODAY, blocks);
    expect(got).toHaveLength(1);
    expect(got[0].shipped).toBe(0);
    expect(got[0].gap).toBeGreaterThanOrEqual(SHIPMENT_GAP_THRESHOLD);
    expect(got[0].expected).toBe(got[0].gap);
  });

  it("기록이 모델과 같으면 잡지 않는다", () => {
    const [{ expected }] = shipmentGapSlots([slot({ id: 1 })], orders, new Map(), TODAY, blocks);
    expect(shipmentGapSlots([slot({ id: 1 })], orders, new Map([[1, expected]]), TODAY, blocks)).toEqual([]);
  });

  it("1회 차이는 정상 운영(오늘 분 출고 전)이라 잡지 않는다", () => {
    const [{ expected }] = shipmentGapSlots([slot({ id: 1 })], orders, new Map(), TODAY, blocks);
    expect(
      shipmentGapSlots([slot({ id: 1 })], orders, new Map([[1, expected - 1]]), TODAY, blocks)
    ).toEqual([]);
  });

  it("시작 전(started_at 없음) 구독은 대상이 아니다", () => {
    expect(
      shipmentGapSlots([slot({ id: 1, started_at: null })], orders, new Map(), TODAY, blocks)
    ).toEqual([]);
  });

  it("누락이 큰 순서로 정렬한다", () => {
    const slots = [slot({ id: 1 }), slot({ id: 2, order_id: "ord-1" })];
    const [{ expected }] = shipmentGapSlots([slot({ id: 1 })], orders, new Map(), TODAY, blocks);
    const got = shipmentGapSlots(
      slots,
      orders,
      new Map([
        [1, expected - 2],
        [2, 0],
      ]),
      TODAY,
      new Map([
        [1, [block("ord-1", 12)]],
        [2, [block("ord-1", 12)]],
      ])
    );
    expect(got.map((x) => x.slot.id)).toEqual([2, 1]);
  });
});
