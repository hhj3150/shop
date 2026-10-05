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
    expect(d.patch.status).toBe(SHIP_STATUS);
    expect(d.notifyShipped).toBe(true);
  });

  it("이미 출고된 '같은 회차' 재저장(배송중) → 송장 갱신하되 문자 재발송 안 함", () => {
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "9999", alreadyShipped: true });
    expect(d.patch.tracking_no).toBe("9999");
    expect(d.patch.status).toBe(SHIP_STATUS);
    expect(d.notifyShipped).toBe(false);
  });

  it("구독 '다음 회차' 새 발송(직전 회차 탓에 배송중이나 이번 회차 미출고) → 회차 문자 발송", () => {
    // 구독은 같은 주문 행을 회차마다 재출고 → status 는 이미 '배송중'이지만
    //   이번 회차(주문|발송일)는 아직 출고 전이므로 그 회차 발송 문자가 나가야 한다.
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "7777", alreadyShipped: false });
    expect(d.patch.tracking_no).toBe("7777");
    expect(d.notifyShipped).toBe(true);
  });

  it("출고는 됐으나 송장 누락으로 입금확인에 묶인 건 → 송장 저장 시 문자 발송", () => {
    const d = decideShipOut({ ...base, status: "입금확인", alreadyShipped: true });
    expect(d.notifyShipped).toBe(true);
  });

  it("이미 발송일 기록됨 → 발송일을 덮어쓰지 않음", () => {
    const d = decideShipOut({ ...base, shipped_at: "2026-06-01" });
    expect(d.patch.shipped_at).toBe("2026-06-01");
  });

  // ★ 송장은 '보냈다'의 증거가 아니라 '추적'의 수단이다.
  //   예전엔 송장이 비면 patch 를 만들지 않아 배송판이 출고를 막았고, stockShipOut 까지
  //   건너뛰어 실제로 나간 회차가 shipment_log 에 남지 않았다(회차 증발의 원인).
  //   로젠 프로그램을 따로 쓰는 이상 송장 입력은 빠질 수밖에 없으므로, 없어도 보낸 것으로 센다.
  it("송장 빈칸 → 그래도 배송중 전환·발송 기록(송장만 null)", () => {
    const d = decideShipOut({ ...base, trackingNo: "" });
    expect(d.patch).toEqual({
      courier: "cj",
      tracking_no: null,
      shipped_at: "2026-06-08",
      status: SHIP_STATUS,
    });
    expect(d.notifyShipped).toBe(true);
    expect(d.hasTracking).toBe(false);
  });

  it("송장이 공백뿐 → 빈칸과 같게 처리(null)", () => {
    const d = decideShipOut({ ...base, trackingNo: "   " });
    expect(d.patch.tracking_no).toBeNull();
    expect(d.hasTracking).toBe(false);
  });

  it("송장 없이 출고해도 발송일·상태는 채워진다 — '입금확인'에 묶이지 않는다", () => {
    const d = decideShipOut({ ...base, status: "입금확인", trackingNo: "" });
    expect(d.patch.status).toBe(SHIP_STATUS);
    expect(d.patch.shipped_at).toBe("2026-06-08");
  });

  it("송장 없이 나간 회차도 같은 회차 재저장이면 문자를 또 보내지 않는다", () => {
    const d = decideShipOut({
      ...base, status: SHIP_STATUS, trackingNo: "", alreadyShipped: true,
    });
    expect(d.notifyShipped).toBe(false);
  });

  it("뒤늦게 송장을 채우면 그대로 실린다", () => {
    const d = decideShipOut({ ...base, status: SHIP_STATUS, trackingNo: "446-7398-6033" });
    expect(d.patch.tracking_no).toBe("446-7398-6033");
    expect(d.hasTracking).toBe(true);
  });

  it("송장 앞뒤 공백 → trim 후 저장", () => {
    const d = decideShipOut({ ...base, trackingNo: "  88 ", status: "입금확인" });
    expect(d.patch.tracking_no).toBe("88");
  });
});
