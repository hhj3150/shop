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

  it("이미 출고된 '같은 회차' 재저장(배송중) → 송장 갱신하되 문자 재발송 안 함", () => {
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "9999", alreadyShipped: true });
    expect(d.patch?.tracking_no).toBe("9999");
    expect(d.patch?.status).toBe(SHIP_STATUS);
    expect(d.notifyShipped).toBe(false);
  });

  it("구독 '다음 회차' 새 발송(직전 회차 탓에 배송중이나 이번 회차 미출고) → 회차 문자 발송", () => {
    // 구독은 같은 주문 행을 회차마다 재출고 → status 는 이미 '배송중'이지만
    //   이번 회차(주문|발송일)는 아직 출고 전이므로 그 회차 발송 문자가 나가야 한다.
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "7777", alreadyShipped: false });
    expect(d.patch?.tracking_no).toBe("7777");
    expect(d.notifyShipped).toBe(true);
  });

  it("출고는 됐으나 송장 누락으로 입금확인에 묶인 건 → 송장 저장 시 문자 발송", () => {
    const d = decideShipOut({ ...base, status: "입금확인", alreadyShipped: true });
    expect(d.notifyShipped).toBe(true);
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
