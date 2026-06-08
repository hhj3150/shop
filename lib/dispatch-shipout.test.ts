import { describe, it, expect } from "vitest";
import { decideShipOut, SHIP_STATUS } from "@/lib/dispatch-shipout";

describe("decideShipOut", () => {
  const base = {
    status: "입금확인",
    shipped_at: null as string | null,
    courier: "cj",
    trackingNo: "1234567890",
    shipISO: "2026-06-08",
  };

  it("송장 있음 + 입금확인 → 배송중 전환·송장 저장·문자 발송", () => {
    const d = decideShipOut(base);
    expect(d.patch).toEqual({
      courier: "cj",
      tracking_no: "1234567890",
      shipped_at: "2026-06-08", // shipped_at 비어 있으면 발송일로 채움
      status: SHIP_STATUS,
    });
    expect(d.notifyShipped).toBe(true);
  });

  it("송장 있음 + 배송준비 → 배송중 전환·문자 발송", () => {
    const d = decideShipOut({ ...base, status: "배송준비" });
    expect(d.patch?.status).toBe(SHIP_STATUS);
    expect(d.notifyShipped).toBe(true);
  });

  it("이미 배송중(구독 2주차 재출고) → 송장은 갱신하되 문자 재발송 안 함", () => {
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "9999" });
    expect(d.patch?.tracking_no).toBe("9999");
    expect(d.patch?.status).toBe(SHIP_STATUS);
    expect(d.notifyShipped).toBe(false);
  });

  it("이미 발송일 기록됨 → 발송일을 덮어쓰지 않음", () => {
    const d = decideShipOut({ ...base, shipped_at: "2026-06-01" });
    expect(d.patch?.shipped_at).toBe("2026-06-01");
  });

  it("송장 빈칸 → 주문 업데이트 없음(재고만 출고)·문자 없음", () => {
    expect(decideShipOut({ ...base, trackingNo: "" })).toEqual({
      patch: null,
      notifyShipped: false,
    });
    expect(decideShipOut({ ...base, trackingNo: "   " })).toEqual({
      patch: null,
      notifyShipped: false,
    });
  });

  it("송장 앞뒤 공백 → trim 후 저장", () => {
    const d = decideShipOut({ ...base, trackingNo: "  88 ", status: "입금확인" });
    expect(d.patch?.tracking_no).toBe("88");
  });
});
