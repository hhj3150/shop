import { describe, it, expect } from "vitest";
import { isCarriedOver, overdueDays } from "./dispatch-overdue";

const D = "2026-06-08";

describe("isCarriedOver", () => {
  it("단품·발송예정일 지남·아직 배송중 아님 → 이월(true)", () => {
    expect(isCarriedOver({ order_type: "단품", ship_date: "2026-06-05", status: "입금확인" }, D)).toBe(true);
  });
  it("발송예정일이 당일이면 이월 아님(false) — 당일분은 기존대로", () => {
    expect(isCarriedOver({ order_type: "단품", ship_date: D, status: "입금확인" }, D)).toBe(false);
  });
  it("이미 배송중이면 이월 아님(false)", () => {
    expect(isCarriedOver({ order_type: "단품", ship_date: "2026-06-05", status: "배송중" }, D)).toBe(false);
  });
  it("발송예정일이 미래면 이월 아님(false)", () => {
    expect(isCarriedOver({ order_type: "단품", ship_date: "2026-06-16", status: "입금확인" }, D)).toBe(false);
  });
  it("구독(ship_date 없음)은 이월 대상 아님(false)", () => {
    expect(isCarriedOver({ order_type: "구독", ship_date: null, status: "입금확인" }, D)).toBe(false);
  });
});

describe("overdueDays", () => {
  it("지난 일수를 일 단위로 센다", () => {
    expect(overdueDays("2026-06-05", D)).toBe(3);
  });
  it("같은 날·미래면 0", () => {
    expect(overdueDays(D, D)).toBe(0);
    expect(overdueDays("2026-06-16", D)).toBe(0);
  });
  it("null 이면 0", () => {
    expect(overdueDays(null, D)).toBe(0);
  });
});
