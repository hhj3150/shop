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
});
