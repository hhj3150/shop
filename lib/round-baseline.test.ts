import { describe, it, expect } from "vitest";
import { confirmedShippedCount, suggestBaseline } from "./round-baseline";

describe("confirmedShippedCount — 확정 기준점 + 이후 기록", () => {
  it("미확정이면 null — 지금 동작이 그대로 유지된다", () => {
    expect(confirmedShippedCount({ confirmedCount: null, confirmedAt: null }, ["2026-10-06"])).toBeNull();
    expect(confirmedShippedCount({ confirmedCount: 8, confirmedAt: null }, [])).toBeNull();
    expect(confirmedShippedCount({ confirmedCount: null, confirmedAt: "2026-10-05" }, [])).toBeNull();
  });

  it("확정값 + 확정일 이후 발송 수", () => {
    const b = { confirmedCount: 8, confirmedAt: "2026-10-05" };
    expect(confirmedShippedCount(b, [])).toBe(8);
    expect(confirmedShippedCount(b, ["2026-10-06"])).toBe(9);
    expect(confirmedShippedCount(b, ["2026-10-06", "2026-10-13"])).toBe(10);
  });

  it("확정일 '당일까지'는 확정값에 포함 — 두 번 세지 않는다", () => {
    const b = { confirmedCount: 8, confirmedAt: "2026-10-05" };
    expect(confirmedShippedCount(b, ["2026-10-05"])).toBe(8);
    expect(confirmedShippedCount(b, ["2026-09-28", "2026-10-05"])).toBe(8);
  });

  // ★ 한 날짜 = 한 회차. 원주문·연장주문을 같은 날 실수로 둘 다 출고하면 행이 둘 생긴다.
  //   그대로 세면 손님이 결제한 회차가 하나 사라진다.
  it("같은 날짜 중복 기록은 한 회차로 센다", () => {
    const b = { confirmedCount: 5, confirmedAt: "2026-09-01" };
    expect(confirmedShippedCount(b, ["2026-09-08", "2026-09-08"])).toBe(6);
    expect(confirmedShippedCount(b, ["2026-09-08", "2026-09-08", "2026-09-15"])).toBe(7);
  });

  it("빈 날짜·음수·소수를 안전하게 처리한다", () => {
    expect(confirmedShippedCount({ confirmedCount: 3, confirmedAt: "2026-09-01" }, ["", "2026-09-08"])).toBe(4);
    expect(confirmedShippedCount({ confirmedCount: -2, confirmedAt: "2026-09-01" }, [])).toBe(0);
    expect(confirmedShippedCount({ confirmedCount: 7.9, confirmedAt: "2026-09-01" }, [])).toBe(7);
  });

  it("확정 0회도 유효하다 — '한 번도 못 받으셨다'를 표현할 수 있어야 한다", () => {
    expect(confirmedShippedCount({ confirmedCount: 0, confirmedAt: "2026-10-05" }, [])).toBe(0);
    expect(confirmedShippedCount({ confirmedCount: 0, confirmedAt: "2026-10-05" }, ["2026-10-12"])).toBe(1);
  });
});

describe("suggestBaseline — 애매하면 손님에게 유리하게", () => {
  it("우리 기록과 택배사 송장이 다르면 적은 쪽", () => {
    expect(suggestBaseline({ paidRounds: 12, recordedCount: 8, courierCount: 14 })).toBe(8);
    expect(suggestBaseline({ paidRounds: 12, recordedCount: 10, courierCount: 6 })).toBe(6);
  });

  it("택배사 수를 모르면 우리 기록만 본다", () => {
    expect(suggestBaseline({ paidRounds: 12, recordedCount: 8, courierCount: null })).toBe(8);
  });

  it("결제 회차를 넘겨 세지 않는다", () => {
    expect(suggestBaseline({ paidRounds: 8, recordedCount: 11, courierCount: 14 })).toBe(8);
  });

  it("아무것도 안 나갔으면 0", () => {
    expect(suggestBaseline({ paidRounds: 12, recordedCount: 0, courierCount: 0 })).toBe(0);
    expect(suggestBaseline({ paidRounds: 12, recordedCount: 0, courierCount: null })).toBe(0);
  });

  it("추천값은 결코 손님에게 불리한 쪽(많은 쪽)으로 가지 않는다", () => {
    // 로젠에 홍보분이 섞여 송장이 더 많아 보이는 상황 — 그걸 회차로 세면 안 된다.
    const s = suggestBaseline({ paidRounds: 24, recordedCount: 9, courierCount: 20 });
    expect(s).toBe(9);
    expect(s).toBeLessThan(20);
  });
});
