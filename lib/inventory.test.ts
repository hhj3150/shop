import { describe, it, expect } from "vitest";
import {
  isLowStock,
  nextStock,
  MOVEMENT_KINDS,
  daysUntil,
  expiryAlert,
  shipmentShortfall,
} from "./inventory";

describe("isLowStock", () => {
  it("현재고 ≤ 안전재고 → 부족", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(0, 5)).toBe(true);
  });
  it("현재고 > 안전재고 → 정상", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });
  it("안전재고 NULL(경보 안 함) → 항상 정상", () => {
    expect(isLowStock(0, null)).toBe(false);
  });
  it("현재고 NULL(무제한) → 항상 정상", () => {
    expect(isLowStock(null, 5)).toBe(false);
    expect(isLowStock(null, null)).toBe(false);
  });
});

describe("shipmentShortfall", () => {
  it("향후 발송 수요 > 현재고 → 부족분(양수)", () => {
    expect(shipmentShortfall(10, 14)).toBe(4);
    expect(shipmentShortfall(0, 3)).toBe(3);
  });
  it("현재고 ≥ 수요 → 0", () => {
    expect(shipmentShortfall(10, 10)).toBe(0);
    expect(shipmentShortfall(20, 5)).toBe(0);
  });
  it("수요 0 또는 음수 → 0", () => {
    expect(shipmentShortfall(5, 0)).toBe(0);
    expect(shipmentShortfall(5, -3)).toBe(0);
  });
  it("현재고 NULL(무제한) → 부족 없음(0)", () => {
    expect(shipmentShortfall(null, 100)).toBe(0);
  });
});

describe("nextStock", () => {
  it("입고(+)·출고(−) 정상 가감", () => {
    expect(nextStock(10, 5)).toBe(15);
    expect(nextStock(10, -4)).toBe(6);
    expect(nextStock(10, -10)).toBe(0); // 0 까지는 허용
  });
  it("0 미만이 되면 차단(throw)", () => {
    expect(() => nextStock(3, -4)).toThrow(/재고 부족/);
  });
  it("현재고 NULL(무제한) → 변동 무시하고 null 반환", () => {
    expect(nextStock(null, -100)).toBe(null);
    expect(nextStock(null, 50)).toBe(null);
  });
});

describe("MOVEMENT_KINDS", () => {
  it("4종 거래 유형(입고·출고·조정·폐기)", () => {
    expect(MOVEMENT_KINDS).toEqual(["입고", "출고", "조정", "폐기"]);
  });
});

describe("daysUntil (KST)", () => {
  it("오늘 만료 → 0", () => {
    // 2026-06-10T01:00 KST = 2026-06-09T16:00Z. KST 오늘은 6/10.
    expect(daysUntil("2026-06-10", new Date("2026-06-09T16:00:00Z"))).toBe(0);
  });
  it("내일 만료 → +1", () => {
    // 2026-06-09T23:00 KST = 2026-06-09T14:00Z. KST 오늘 6/9, 만료 6/10.
    expect(daysUntil("2026-06-10", new Date("2026-06-09T14:00:00Z"))).toBe(1);
  });
  it("지난 유통기한 → 음수", () => {
    expect(daysUntil("2026-06-08", new Date("2026-06-10T03:00:00Z"))).toBe(-2);
  });
});

describe("expiryAlert (D-3)", () => {
  const today = new Date("2026-06-10T03:00:00Z"); // KST 6/10 정오

  it("오늘 만료(days=0) → warning", () => {
    expect(expiryAlert(["2026-06-10"], today)).toEqual({
      status: "warning",
      nearest: "2026-06-10",
      days: 0,
    });
  });
  it("D-3 경계(days=3) → warning", () => {
    expect(expiryAlert(["2026-06-13"], today).status).toBe("warning");
  });
  it("D-4(days=4) → ok", () => {
    expect(expiryAlert(["2026-06-14"], today)).toEqual({
      status: "ok",
      nearest: "2026-06-14",
      days: 4,
    });
  });
  it("여러 개면 가장 임박한 미래분 기준", () => {
    expect(expiryAlert(["2026-07-20", "2026-06-12"], today)).toEqual({
      status: "warning",
      nearest: "2026-06-12",
      days: 2,
    });
  });
  it("전부 과거 → expired(가장 최근 과거)", () => {
    const r = expiryAlert(["2026-06-01", "2026-06-08"], today);
    expect(r.status).toBe("expired");
    expect(r.nearest).toBe("2026-06-08");
    expect(r.days).toBeLessThan(0);
  });
  it("빈 배열 → none", () => {
    expect(expiryAlert([], today)).toEqual({ status: "none", nearest: null, days: null });
  });
});
