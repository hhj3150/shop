import { describe, it, expect } from "vitest";
import { buildCustomer360, type C360Input, type C360Order, type C360Slot } from "./customer-360";

const TODAY = "2026-06-15";

function order(over: Partial<C360Order> = {}): C360Order {
  return {
    id: "o1", user_id: "u1", order_no: "ORD-1", status: "배송중",
    order_type: "구독", block_weeks: 8, total_amount: 100000,
    created_at: "2026-06-01T00:00:00Z",
    paid_at: null, pay_method: null,
    courier: null, tracking_no: null, shipped_at: null,
    cash_receipt_type: null, cash_receipt_issued: null,
    ...over,
  };
}

function slot(over: Partial<C360Slot> = {}): C360Slot {
  return {
    id: 1, user_id: "u1", order_id: "o1", delivery_day: "mon",
    status: "활성", started_at: "2026-06-08", paused: false,
    paused_at: null, paused_days: 0, extended_weeks: 0,
    refund_amount: null, cancelled_at: null,
    ...over,
  };
}

function input(over: Partial<C360Input> = {}): C360Input {
  return {
    userId: "u1", name: "이름폴백",
    orders: [], items: [], slots: [], returns: [],
    profile: null, summary: null, todayISO: TODAY,
    ...over,
  };
}

describe("buildCustomer360", () => {
  it("빈 데이터면 빈 배열과 폴백 이름을 돌려준다", () => {
    const c = buildCustomer360(input());
    expect(c.orders).toEqual([]);
    expect(c.subscriptions).toEqual([]);
    expect(c.refunds).toEqual([]);
    expect(c.header.name).toBe("이름폴백");
  });

  it("프로필이 있으면 프로필 이름을 우선한다", () => {
    const c = buildCustomer360(input({
      profile: { name: "송영신", phone: "010", postcode: null, address: null, address_detail: null },
    }));
    expect(c.header.name).toBe("송영신");
  });

  it("주문을 최신순으로 정렬하고 인라인 입금·송장·영수증을 구성한다", () => {
    const c = buildCustomer360(input({
      orders: [
        order({ id: "old", order_no: "ORD-OLD", created_at: "2026-05-01T00:00:00Z" }),
        order({
          id: "new", order_no: "ORD-NEW", created_at: "2026-06-10T00:00:00Z",
          paid_at: "2026-06-10", pay_method: "카드",
          courier: "CJ", tracking_no: "123", shipped_at: "2026-06-11",
          cash_receipt_type: "소득공제", cash_receipt_issued: true,
        }),
      ],
      items: [{ order_id: "new", product_name: "유정란", volume: "30구", qty: 2 }],
    }));
    expect(c.orders.map((o) => o.orderNo)).toEqual(["ORD-NEW", "ORD-OLD"]);
    const n = c.orders[0];
    expect(n.deposit).toEqual({ paidAt: "2026-06-10", payMethod: "카드" });
    expect(n.tracking).toEqual({ courier: "CJ", trackingNo: "123", shippedAt: "2026-06-11" });
    expect(n.receipt).toEqual({ type: "소득공제", issued: true });
    expect(n.items).toEqual([{ productName: "유정란", volume: "30구", qty: 2 }]);
  });

  it("입금·송장·영수증 정보가 없으면 해당 인라인을 null 로 둔다", () => {
    const c = buildCustomer360(input({ orders: [order()] }));
    expect(c.orders[0].deposit).toBeNull();
    expect(c.orders[0].tracking).toBeNull();
    expect(c.orders[0].receipt).toBeNull();
  });

  it("진행 중 구독: total=block+extended, 잔여>0, 상태 활성", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", block_weeks: 8 })],
      slots: [slot({ extended_weeks: 0, started_at: "2026-06-08" })],
    }));
    const s = c.subscriptions[0];
    // 8주 구독을 시작 7일째(TODAY)에 평가 → 아직 잔여가 남아 활성.
    expect(s.total).toBe(8);
    expect(s.remaining).toBeGreaterThan(0);
    expect(s.state).toBe("활성");
    expect(s.weekdayLabel).toBe("월");
  });

  it("회차 소진(과거 시작·소량 회차)이면 잔여 0·상태 완료", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", block_weeks: 4 })],
      slots: [slot({ started_at: "2026-01-01", extended_weeks: 0 })],
    }));
    const s = c.subscriptions[0];
    expect(s.remaining).toBe(0);
    expect(s.state).toBe("완료");
  });

  it("정지·해지 슬롯은 상태가 정지·해지로 매핑된다", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1" })],
      slots: [
        slot({ id: 1, paused: true, paused_at: "2026-06-10" }),
        slot({ id: 2, status: "해지", cancelled_at: "2026-06-09" }),
      ],
    }));
    const byId = new Map(c.subscriptions.map((s) => [s.slotId, s.state]));
    expect(byId.get(1)).toBe("정지");
    expect(byId.get(2)).toBe("해지");
  });

  it("환불을 구독해지 + 환불접수로 합본해 날짜 내림차순 정렬한다", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", order_no: "ORD-1" })],
      slots: [slot({ status: "해지", refund_amount: 60000, cancelled_at: "2026-05-20" })],
      returns: [{ order_id: "o1", type: "환불", amount: 12000, created_at: "2026-06-01" }],
    }));
    expect(c.refunds.map((r) => r.source)).toEqual(["환불접수", "구독해지"]);
    expect(c.refunds[0].amount).toBe(12000);
    expect(c.refunds[1].label).toContain("구독 해지");
  });

  it("다른 user 의 주문·슬롯·환불은 섞이지 않는다", () => {
    const c = buildCustomer360(input({
      userId: "u1",
      orders: [order({ id: "o1", user_id: "u1" }), order({ id: "o2", user_id: "u2" })],
      slots: [slot({ id: 9, user_id: "u2" })],
      returns: [{ order_id: "o2", type: "환불", amount: 1, created_at: "2026-06-01" }],
    }));
    expect(c.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(c.subscriptions).toEqual([]);
    expect(c.refunds).toEqual([]);
  });
});
