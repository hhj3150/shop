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

  it("이미 예고된 건이 없으면 활성 구독 + 단품이 모두 포함된다", () => {
    const orders: ReminderOrder[] = [
      sub("A"),
      { ...sub("C"), order_type: "단품", block_weeks: null, ship_date: WED },
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
    });
    expect(m.text).toContain("홍길동님");
    expect(m.text).toContain("6월 24일(수)");
    expect(m.text).toContain("우유 750ml 2개");
    expect(m.text).toContain("요거트 500ml");
    expect(m.subject).toContain("내일 발송");
  });
});
