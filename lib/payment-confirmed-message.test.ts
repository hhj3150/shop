import { describe, it, expect } from "vitest";
import { buildPaymentConfirmedMessage } from "./payment-confirmed-message";

describe("buildPaymentConfirmedMessage", () => {
  it("택배: 발송 예정일을 'M월 D일에 발송' 으로 안내", () => {
    const m = buildPaymentConfirmedMessage({
      shipName: "김손님",
      orderNo: "SY20260830-1234",
      shipDate: "2026-09-07",
      deliveryMethod: "택배",
    });
    expect(m.text).toContain("김손님님, 입금이 확인되었습니다.");
    expect(m.text).toContain("주문번호 SY20260830-1234");
    expect(m.text).toContain("9월 7일에 발송해 드립니다.");
    expect(m.variables).toEqual({ "#{고객명}": "김손님", "#{주문번호}": "SY20260830-1234" });
  });

  it("방문수령: '목장에서 수령' 으로 안내", () => {
    const m = buildPaymentConfirmedMessage({
      shipName: "김손님",
      orderNo: "SY1",
      shipDate: "2026-09-07",
      deliveryMethod: "방문수령",
    });
    expect(m.text).toContain("9월 7일부터 목장에서 수령하실 수 있습니다.");
  });

  it("발송일 미정: 날짜 없이 순차 발송으로 안내", () => {
    const m = buildPaymentConfirmedMessage({
      shipName: null,
      orderNo: "SY2",
      shipDate: null,
      deliveryMethod: null,
    });
    expect(m.text).toContain("고객님, 입금이 확인되었습니다.");
    expect(m.text).toContain("순차 발송해 드리겠습니다.");
  });
});
