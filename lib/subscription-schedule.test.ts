import { describe, it, expect } from "vitest";
import { computeSchedule, type SubInput } from "./subscription-schedule";

const d = (iso: string) => new Date(`${iso}T00:00:00`);

// 4주 구독, 시작 2026-06-01(월). 정지 없음 기준.
function base(over: Partial<SubInput> = {}): SubInput {
  return {
    startedAt: "2026-06-01",
    totalWeeks: 4,
    paused: false,
    pausedAt: null,
    pausedDays: 0,
    ...over,
  };
}

describe("computeSchedule", () => {
  it("미시작(startedAt=null) → delivered 0, remaining=총회차, 미완료", () => {
    const s = computeSchedule(base({ startedAt: null }), d("2026-06-10"));
    expect(s.started).toBe(false);
    expect(s.delivered).toBe(0);
    expect(s.remaining).toBe(4);
    expect(s.done).toBe(false);
    expect(s.nextDate).toBeNull();
  });

  it("3회차 시점 → delivered 3, remaining 1, 다음 배송일 06-22", () => {
    const s = computeSchedule(base(), d("2026-06-15"));
    expect(s.delivered).toBe(3);
    expect(s.remaining).toBe(1);
    expect(s.nextDate).toBe("2026-06-22");
    expect(s.endDate).toBe("2026-06-22");
    expect(s.done).toBe(false);
  });

  it("4회 모두 경과 → delivered 4, remaining 0, done, 다음 배송일 없음", () => {
    const s = computeSchedule(base(), d("2026-06-22"));
    expect(s.delivered).toBe(4);
    expect(s.remaining).toBe(0);
    expect(s.done).toBe(true);
    expect(s.nextDate).toBeNull();
  });

  it("delivered 는 총 회차를 넘지 않는다", () => {
    const s = computeSchedule(base(), d("2026-12-31"));
    expect(s.delivered).toBe(4);
    expect(s.remaining).toBe(0);
  });

  it("정지 누적일(paused_days=7)만큼 배송이 뒤로 밀려 delivered 가 준다", () => {
    // 06-22 기준 정지 없으면 4회(done)지만, 7일 밀려 3회까지만.
    const s = computeSchedule(base({ pausedDays: 7 }), d("2026-06-22"));
    expect(s.delivered).toBe(3);
    expect(s.done).toBe(false);
  });

  it("현재 정지중(paused)이면 nextDate 없음 + 정지일이 매일 누적돼 delivered 멈춤", () => {
    // 06-08 정지 시작, 06-22 기준 currentPause=14일 → 06-08 1회만 완료된 채 멈춤.
    const s = computeSchedule(
      base({ paused: true, pausedAt: "2026-06-08" }),
      d("2026-06-22")
    );
    expect(s.paused).toBe(true);
    expect(s.nextDate).toBeNull();
    expect(s.delivered).toBe(2);
  });

  it("연장(totalWeeks=8) → 5회차 시점 delivered 5, remaining 3", () => {
    const s = computeSchedule(base({ totalWeeks: 8 }), d("2026-06-29"));
    expect(s.delivered).toBe(5);
    expect(s.remaining).toBe(3);
    expect(s.endDate).toBe("2026-07-20");
  });

  // ── 첫배송 공휴일 시프트(firstShipDate): 앵커(started_at, 선택 요일)는 그대로 두고
  //    1회차만 다음 영업일로. 2회차+ 는 앵커 요일 cadence 유지. ──
  describe("firstShipDate(첫배송 공휴일 → 다음 영업일)", () => {
    // 앵커 06-01(월)이 공휴일이라 첫배송만 06-02(화)로 시프트된 4주 구독 가정.
    const shifted = (over: Partial<SubInput> = {}) =>
      base({ firstShipDate: "2026-06-02", ...over });

    it("앵커 당일(06-01)에는 아직 1회차 미발송 — delivered 0, 다음 발송 06-02", () => {
      const s = computeSchedule(shifted(), d("2026-06-01"));
      expect(s.delivered).toBe(0);
      expect(s.nextDate).toBe("2026-06-02");
    });

    it("시프트된 첫배송일(06-02) — delivered 1, 다음 발송은 앵커 요일 06-08", () => {
      const s = computeSchedule(shifted(), d("2026-06-02"));
      expect(s.delivered).toBe(1);
      expect(s.nextDate).toBe("2026-06-08");
    });

    it("2회차+ 와 종료일은 앵커 요일 그대로 — 06-15 시점 delivered 3, endDate 06-22", () => {
      const s = computeSchedule(shifted(), d("2026-06-15"));
      expect(s.delivered).toBe(3);
      expect(s.endDate).toBe("2026-06-22");
    });

    it("firstShipDate 없으면(보정 불필요) 기존과 동일 — 1회차=앵커", () => {
      const s = computeSchedule(base(), d("2026-06-01"));
      expect(s.delivered).toBe(1); // 앵커 당일 발송
      const sShift = computeSchedule(shifted(), d("2026-06-01"));
      expect(sShift.delivered).toBe(0); // 시프트되면 앵커 당일은 아직
    });
  });
});

describe("주차별 공휴일 시프트", () => {
  const base = { startedAt: "2026-04-28", firstShipDate: null, paused: false, pausedAt: null, pausedDays: 0 };

  it("공휴일에 걸린 2회차는 다음 영업일로 시프트(endDate 반영)", () => {
    const s = computeSchedule({ ...base, totalWeeks: 2 }, new Date("2026-05-06T00:00:00"));
    expect(s.endDate).toBe("2026-05-06");
    expect(s.delivered).toBe(2);
  });
  it("공휴일 당일(05-05)엔 2회차 미완료, nextDate=05-06", () => {
    const s = computeSchedule({ ...base, totalWeeks: 2 }, new Date("2026-05-05T00:00:00"));
    expect(s.delivered).toBe(1);
    expect(s.nextDate).toBe("2026-05-06");
  });
  it("k=1 firstShipDate idempotent — 보정값 재전진 no-op", () => {
    const inp = { startedAt: "2026-05-05", firstShipDate: "2026-05-06", paused: false, pausedAt: null, pausedDays: 0, totalWeeks: 1 };
    expect(computeSchedule(inp, new Date("2026-05-06T00:00:00")).endDate).toBe("2026-05-06");
  });
  it("최장 연휴 클러스터에서 단조·무충돌", () => {
    const inp = { startedAt: "2027-02-01", firstShipDate: null, paused: false, pausedAt: null, pausedDays: 0, totalWeeks: 3 };
    const s = computeSchedule(inp, new Date("2027-02-20T00:00:00"));
    expect(s.endDate).toBe("2027-02-15"); // 3회차(월·평일) 그대로
    expect(s.delivered).toBe(3);
  });
});
