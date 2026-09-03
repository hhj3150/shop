import { describe, it, expect } from "vitest";
import {
  buildReminderTargets,
  buildShipReminderMessage,
  type ReminderOrder,
  type ReminderItem,
  type ReminderSlot,
} from "@/lib/ship-reminder";
import type { DeliveryDay } from "@/lib/cart";

// 2026-06-24 는 수요일(weekday) — wed 구독이 이날 배송된다.
const WED = "2026-06-24";

function sub(id: string, over: Partial<ReminderOrder> = {}): ReminderOrder {
  return {
    id,
    order_no: `NO-${id}`,
    status: "배송중",
    order_type: "구독",
    block_weeks: 8,
    shipping_fee: 0,
    created_at: "2026-05-30T00:00:00Z",
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
    started_at: "2026-06-01",
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    ...over,
  };
}
function wedItem(orderId: string): ReminderItem {
  return { order_id: orderId, product_name: "우유", volume: "750ml", delivery_day: "wed" as DeliveryDay, qty: 1, unit_price: 5000 };
}

describe("buildReminderTargets", () => {
  it("그 발송일 배송분만 추리고 정지·이미예고·방문수령·무전화는 제외한다", () => {
    const orders: ReminderOrder[] = [
      sub("A"), // 활성 구독 → 포함
      sub("B"), // 정지 구독 → 제외
      sub("D"), // 활성이지만 이미 예고 → 제외
      sub("E", { delivery_method: "방문수령" }), // 방문수령 → 제외
      sub("F", { ship_phone: null }), // 전화 없음 → 제외
      // 단품: 그날 ship_date → 포함
      {
        ...sub("C"),
        order_type: "단품",
        status: "입금확인",
        block_weeks: null,
        ship_date: WED,
      },
    ];
    const slots: ReminderSlot[] = [
      slot(1, "A"),
      slot(2, "B", { paused: true, paused_at: "2026-06-10" }),
      slot(3, "D"),
      slot(4, "E"),
      slot(5, "F"),
    ];
    const items: ReminderItem[] = [
      wedItem("A"),
      wedItem("B"),
      wedItem("D"),
      wedItem("E"),
      wedItem("F"),
      wedItem("C"),
    ];

    const targets = buildReminderTargets({
      dateISO: WED,
      orders,
      items,
      slots,
      remindedOrderIds: new Set(["D"]),
    });

    const ids = new Set(targets.map((t) => t.orderId));
    expect(ids).toEqual(new Set(["A", "C"]));
  });

  // 신일수 사례 회귀: 입금은 했지만 사정상 8월부터 시작하는 구독 —
  //   관리자가 시작일을 미래로 연기(started_at 미래)하면 그 전엔 예고 문자가 나가면 안 된다.
  it("시작일이 미래로 연기된 구독은 그 전 발송일의 예고 대상에서 제외된다", () => {
    const orders: ReminderOrder[] = [sub("A"), sub("G")];
    const slots: ReminderSlot[] = [
      slot(1, "A"),
      slot(6, "G", { started_at: "2026-08-03" }), // 6/24 시점엔 아직 시작 전
    ];
    const targets = buildReminderTargets({
      dateISO: WED,
      orders,
      items: [wedItem("A"), wedItem("G")],
      slots,
      remindedOrderIds: new Set(),
    });
    expect(new Set(targets.map((t) => t.orderId))).toEqual(new Set(["A"]));
  });

  it("이미 예고된 건이 없으면 활성 구독 + 단품이 모두 포함된다", () => {
    const orders: ReminderOrder[] = [
      sub("A"),
      // 단품은 아직 미발송(입금확인) 상태여야 예고 대상 — 배송중이면 이미 발송된 건이다.
      { ...sub("C"), order_type: "단품", status: "입금확인", block_weeks: null, ship_date: WED },
    ];
    const targets = buildReminderTargets({
      dateISO: WED,
      orders,
      items: [wedItem("A"), wedItem("C")],
      slots: [slot(1, "A")],
      remindedOrderIds: new Set(),
    });
    expect(new Set(targets.map((t) => t.orderId))).toEqual(new Set(["A", "C"]));
  });
});

describe("buildShipReminderMessage", () => {
  it("내일 발송일·요일·제품요약을 담는다", () => {
    const m = buildShipReminderMessage({
      orderId: "A",
      orderNo: "NO-A",
      shipDate: WED,
      shipName: "홍길동",
      shipPhone: "01000000000",
      isGift: false,
      gifterName: null,
      items: [
        { product_name: "우유", volume: "750ml", qty: 2 },
        { product_name: "요거트", volume: "500ml", qty: 1 },
      ],
      kind: "정기",
      shiftedFromDay: null,
    });
    expect(m.text).toContain("홍길동님");
    expect(m.text).toContain("6월 24일(수)");
    expect(m.text).toContain("우유 750ml 2개");
    expect(m.text).toContain("요거트 500ml");
    expect(m.subject).toContain("내일 발송");
  });
});


describe("buildReminderTargets — 이미 발송된 건 제외(중복 예고 방지)", () => {
  const once = (id: string, over: Partial<ReminderOrder> = {}): ReminderOrder => ({
    ...sub(id),
    order_type: "단품",
    status: "입금확인",
    block_weeks: null,
    ship_date: WED,
    ...over,
  });

  it("그 발송일분을 이미 출고한 주문(dispatchedOrderIds)은 예고하지 않는다", () => {
    const targets = buildReminderTargets({
      dateISO: WED,
      orders: [sub("A"), once("C")],
      items: [wedItem("A"), wedItem("C")],
      slots: [slot(1, "A")],
      remindedOrderIds: new Set(),
      dispatchedOrderIds: new Set(["A", "C"]),
    });
    expect(targets).toEqual([]);
  });

  it("송장·발송일이 이미 찍힌 단품은 예고하지 않는다(회차 이력 없는 레거시 건)", () => {
    const targets = buildReminderTargets({
      dateISO: WED,
      orders: [
        once("C", { tracking_no: "123-456" }),
        once("D", { shipped_at: WED }),
        once("E", { status: "배송중" }),
        once("F"), // 아직 미발송 → 포함
      ],
      items: [wedItem("C"), wedItem("D"), wedItem("E"), wedItem("F")],
      slots: [],
      remindedOrderIds: new Set(),
    });
    expect(targets.map((t) => t.orderId)).toEqual(["F"]);
  });

  it("주문 당일 저녁 예고는 접수 문자와 중복이라 보내지 않는다(단품만)", () => {
    // 예고는 발송일 전날(6/23) 저녁에 나간다. 그날 들어온 단품 주문은 몇 시간 전
    //   '주문 접수·입금 안내' 문자에서 이미 같은 발송일을 안내받았다.
    const targets = buildReminderTargets({
      dateISO: WED,
      orders: [
        once("C", { created_at: "2026-06-23T06:35:00Z" }), // KST 6/23 15:35 → 제외
        once("D", { created_at: "2026-06-22T02:00:00Z" }), // KST 6/22 → 포함
      ],
      items: [wedItem("C"), wedItem("D")],
      slots: [],
      remindedOrderIds: new Set(),
    });
    expect(targets.map((t) => t.orderId)).toEqual(["D"]);
  });

  it("구독은 같은 주문 행이 회차마다 재출고되므로 당일 주문 규칙을 적용하지 않는다", () => {
    const targets = buildReminderTargets({
      dateISO: WED,
      orders: [sub("A", { created_at: "2026-06-23T06:35:00Z", tracking_no: "999", shipped_at: "2026-06-17" })],
      items: [wedItem("A")],
      slots: [slot(1, "A")],
      remindedOrderIds: new Set(),
    });
    expect(targets.map((t) => t.orderId)).toEqual(["A"]);
  });
});

describe("공휴일로 발송일이 옮겨진 회차 — 예고 문자에 이유를 먼저 알린다", () => {
  // 2026-10-09(금) 한글날 → 금요일분은 같은 주 앞으로 당겨 10-08(목)에 나간다.
  const THU = "2026-10-08";
  function friItem(orderId: string): ReminderItem {
    return {
      order_id: orderId, product_name: "우유", volume: "750ml",
      delivery_day: "fri" as DeliveryDay, qty: 1, unit_price: 5000,
    };
  }

  it("앞당겨진 금요일분에 shiftedFromDay 가 붙는다", () => {
    const targets = buildReminderTargets({
      dateISO: THU,
      orders: [sub("A")],
      items: [friItem("A")],
      slots: [slot(1, "A", { started_at: "2026-09-04" })], // 금요일 앵커
      remindedOrderIds: new Set(),
    });
    expect(targets.map((t) => t.orderId)).toEqual(["A"]);
    expect(targets[0].shiftedFromDay).toBe("fri");
  });

  it("평소 요일에 나가는 회차에는 붙지 않는다", () => {
    const targets = buildReminderTargets({
      dateISO: WED,
      orders: [sub("A")],
      items: [wedItem("A")],
      slots: [slot(1, "A")],
      remindedOrderIds: new Set(),
    });
    expect(targets[0].shiftedFromDay).toBeNull();
  });

  it("문자에 원래 요일과 사유가 들어간다", () => {
    const m = buildShipReminderMessage({
      orderId: "A", orderNo: "NO-A", shipDate: THU, shipName: "홍길동",
      shipPhone: "01000000000", isGift: false, gifterName: null,
      items: [{ product_name: "우유", volume: "750ml", qty: 1 }],
      kind: "정기", shiftedFromDay: "fri",
    });
    expect(m.text).toContain("10월 8일(목)");
    expect(m.text).toContain("원래 금요일 배송분");
    expect(m.text).toContain("공휴일");
  });
});
