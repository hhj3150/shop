import { describe, it, expect } from "vitest";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";

// 4주(주1회) 구독, 시작 2026-06-01(월). 정지·연장 없음의 기준 슬롯.
function baseSlot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
  return {
    status: "활성",
    started_at: "2026-06-01",
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 0,
    ...over,
  };
}

describe("dispatchScheduleForSlot", () => {
  it("4주 구독 1회차: 시작일 발송 → 1/4회, 남은 3, 제외 안 됨", () => {
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-01");
    expect(r).toEqual({ excluded: false, round: 1, total: 4, remaining: 3 });
  });

  it("4주 구독 3회차: 2주 뒤 발송 → 3/4회, 남은 1", () => {
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-15");
    expect(r).toEqual({ excluded: false, round: 3, total: 4, remaining: 1 });
  });

  // ── 회귀 가드: 마지막 회차 누락 버그(과소배송) ──
  it("4주 구독 마지막(4회차) 발송일 당일 → 발송 대상이므로 제외 안 됨, 4/4회", () => {
    // 4회차 발송일 = 06-22. 그날 실제로 발송하므로 명단/큐에 남아야 한다.
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-22");
    expect(r).toEqual({ excluded: false, round: 4, total: 4, remaining: 0 });
  });

  it("4주 구독: 마지막 발송일을 지난 날짜(1주 후) → 제외", () => {
    // 06-29 는 마지막 발송일 06-22 이후 → 회차소진으로 제외.
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-29");
    expect(r.excluded).toBe(true);
  });

  it("일시정지(paused) 구독 → 회차와 무관하게 제외", () => {
    const r = dispatchScheduleForSlot(
      baseSlot({ paused: true, paused_at: "2026-06-10" }),
      4,
      "2026-06-15"
    );
    expect(r.excluded).toBe(true);
  });

  it("해지(status='해지') 슬롯 → 제외", () => {
    const r = dispatchScheduleForSlot(baseSlot({ status: "해지" }), 4, "2026-06-08");
    expect(r.excluded).toBe(true);
  });

  it("연장(8주, extended_weeks=4) 5회차 정확 표시 → 5/8회, 남은 3, 제외 안 됨", () => {
    // 5회차 발송일 = 06-29. total = block 4 + extended 4 = 8.
    const r = dispatchScheduleForSlot(baseSlot({ extended_weeks: 4 }), 4, "2026-06-29");
    expect(r).toEqual({ excluded: false, round: 5, total: 8, remaining: 3 });
  });

  it("연장(8주) 마지막(8회차) 발송일 당일 → 제외 안 됨, 8/8회", () => {
    // 8회차 발송일 = 07-20. 당일은 발송 대상.
    const r = dispatchScheduleForSlot(baseSlot({ extended_weeks: 4 }), 4, "2026-07-20");
    expect(r).toEqual({ excluded: false, round: 8, total: 8, remaining: 0 });
  });

  it("연장(8주): 마지막 발송일(07-20)을 지난 날짜(07-27) → 제외", () => {
    const r = dispatchScheduleForSlot(baseSlot({ extended_weeks: 4 }), 4, "2026-07-27");
    expect(r.excluded).toBe(true);
    expect(r.total).toBe(8);
  });

  it("정지 누적일(paused_days)만큼 모든 회차가 뒤로 밀린다", () => {
    // 7일 정지 이력 → 4회차 발송일이 06-22→06-29 로 밀림.
    // 06-22 기준: 정지 없으면 4회차(마지막)지만, 7일 밀려 3회차 → 미제외, 3/4회.
    const r = dispatchScheduleForSlot(baseSlot({ paused_days: 7 }), 4, "2026-06-22");
    expect(r.excluded).toBe(false);
    expect(r.round).toBe(3);
    expect(r.remaining).toBe(1);
  });

  it("정지 누적일 반영: 밀린 마지막 발송일(06-29) 당일 → 제외 안 됨, 4/4회", () => {
    // paused_days=7 이면 마지막 발송일이 06-29 로 밀린다 → 그날은 발송 대상.
    const r = dispatchScheduleForSlot(baseSlot({ paused_days: 7 }), 4, "2026-06-29");
    expect(r).toEqual({ excluded: false, round: 4, total: 4, remaining: 0 });
  });

  it("발송일이 시작 전이어도 회차는 최소 1로 표시", () => {
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-05-25");
    expect(r.round).toBe(1);
  });

  // ── 미래 시작일 지정(구독 시작일 연기) ──
  it("시작일 전 발송일은 제외(미래 시작 지정 시 그 전엔 발송 안 함)", () => {
    // started_at 을 06-08 로 지정 → 06-01 발송일은 아직 시작 전 → 제외.
    const r = dispatchScheduleForSlot(baseSlot({ started_at: "2026-06-08" }), 4, "2026-06-01");
    expect(r.excluded).toBe(true);
  });

  it("지정한 시작일 당일은 발송한다(제외 안 됨)", () => {
    const r = dispatchScheduleForSlot(baseSlot({ started_at: "2026-06-08" }), 4, "2026-06-08");
    expect(r.excluded).toBe(false);
  });
});
