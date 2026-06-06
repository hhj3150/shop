import { describe, it, expect } from "vitest";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";

// 로컬 자정 Date 생성기 — computeSchedule 은 연/월/일만 사용한다.
const d = (iso: string) => new Date(`${iso}T00:00:00`);

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
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-01", d("2026-06-01"));
    expect(r).toEqual({ excluded: false, round: 1, total: 4, remaining: 3 });
  });

  it("4주 구독 3회차: 2주 뒤 발송 → 3/4회, 남은 1", () => {
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-15", d("2026-06-15"));
    expect(r).toEqual({ excluded: false, round: 3, total: 4, remaining: 1 });
  });

  it("4주 구독 4회 완료(마지막 발송일 경과) → 큐에서 제외", () => {
    // 4회차 발송일 = 06-22. 그날까지 4회 모두 배송 완료 → done → 제외.
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-06-22", d("2026-06-22"));
    expect(r.excluded).toBe(true);
    expect(r.total).toBe(4);
  });

  it("일시정지(paused) 구독 → 회차와 무관하게 제외", () => {
    const r = dispatchScheduleForSlot(
      baseSlot({ paused: true, paused_at: "2026-06-10" }),
      4,
      "2026-06-15",
      d("2026-06-15")
    );
    expect(r.excluded).toBe(true);
  });

  it("해지(status='해지') 슬롯 → 제외", () => {
    const r = dispatchScheduleForSlot(baseSlot({ status: "해지" }), 4, "2026-06-08", d("2026-06-08"));
    expect(r.excluded).toBe(true);
  });

  it("연장(8주, extended_weeks=4) 5회차 정확 표시 → 5/8회, 남은 3, 제외 안 됨", () => {
    // 5회차 발송일 = 06-29. total = block 4 + extended 4 = 8.
    const r = dispatchScheduleForSlot(baseSlot({ extended_weeks: 4 }), 4, "2026-06-29", d("2026-06-29"));
    expect(r).toEqual({ excluded: false, round: 5, total: 8, remaining: 3 });
  });

  it("연장(8주) 8회차 완료 → 제외", () => {
    // 8회차 발송일 = 07-20. 그날 기준 done.
    const r = dispatchScheduleForSlot(baseSlot({ extended_weeks: 4 }), 4, "2026-07-20", d("2026-07-20"));
    expect(r.excluded).toBe(true);
    expect(r.total).toBe(8);
  });

  it("정지 누적일(paused_days)만큼 모든 회차가 뒤로 밀린다", () => {
    // 7일 정지 이력 → 4회차 발송일이 06-22→06-29 로 밀림.
    // 06-22 기준: 정지 없으면 4회 완료(제외)지만, 7일 밀려 3회차까지만 → 미제외, 3/4회.
    const r = dispatchScheduleForSlot(
      baseSlot({ paused_days: 7 }),
      4,
      "2026-06-22",
      d("2026-06-22")
    );
    expect(r.excluded).toBe(false);
    expect(r.round).toBe(3);
    expect(r.remaining).toBe(1);
  });

  it("발송일이 시작 전이어도 회차는 최소 1로 표시", () => {
    const r = dispatchScheduleForSlot(baseSlot(), 4, "2026-05-25", d("2026-05-25"));
    expect(r.round).toBe(1);
  });
});
