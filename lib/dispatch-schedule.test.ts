import { describe, it, expect } from "vitest";
import {
  dispatchScheduleForSlot,
  slotShipsOn,
  pickSlotForShipDate,
  type DispatchSlotInfo,
} from "./dispatch-schedule";

// 4주(주1회) 구독, 시작 2026-06-01(월). 정지·연장 없음의 기준 슬롯.
function baseSlot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
  return {
    status: "활성",
    started_at: "2026-06-01",
    first_ship_date: null,
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

describe("slotShipsOn / pickSlotForShipDate", () => {
  it("배송일 당일이면 true, 배송 없는 날이면 false", () => {
    const s = baseSlot(); // 06-01 시작, 매주 월요일 4회
    expect(slotShipsOn(s, 4, "2026-06-01")).toBe(true);
    expect(slotShipsOn(s, 4, "2026-06-08")).toBe(true);
    expect(slotShipsOn(s, 4, "2026-06-09")).toBe(false);
    expect(slotShipsOn(s, 4, "2026-06-29")).toBe(false); // 회차 소진 이후
  });

  it("한 주문에 요일이 다른 슬롯 둘 → 그 날짜에 배송이 놓인 슬롯을 고른다", () => {
    const mon = { slot: baseSlot({ started_at: "2026-06-01" }), blockWeeks: 4 }; // 월
    const wed = { slot: baseSlot({ started_at: "2026-06-03" }), blockWeeks: 4 }; // 수
    expect(pickSlotForShipDate([mon, wed], "2026-06-10")).toBe(wed);
    expect(pickSlotForShipDate([mon, wed], "2026-06-15")).toBe(mon);
  });

  it("후보가 하나면 그대로 쓴다(날짜가 어긋나도 회차 표기는 유지)", () => {
    const only = { slot: baseSlot(), blockWeeks: 4 };
    expect(pickSlotForShipDate([only], "2026-06-03")).toBe(only);
  });

  it("후보 없음이면 null", () => {
    expect(pickSlotForShipDate([], "2026-06-01")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 회차소진을 '날짜'가 아니라 '발송 수'로 판정 (shippedCount)
//
//   [사고] 달력이 종료일을 지나면 excluded 가 되어 배송 명단에서 빠졌다. 그래서 연장
//     입금이 늦어 생긴 공백이나 기록 누락만큼, 손님이 결제한 회차가 조용히 사라졌다.
//   [규칙] 결제한 회차를 다 보냈을 때에만 끝난다.
// ─────────────────────────────────────────────────────────────────────────────
describe("dispatchScheduleForSlot — 발송 수 기준 소진", () => {
  const slot = {
    status: "활성",
    started_at: "2026-06-08",
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: 0,
    extended_weeks: 12, // 원주문 4주 + 연장 12주 = 16회
  };
  const 종료일이후 = "2026-11-30"; // 달력상 16회차를 한참 지난 날

  it("옛 방식: 날짜가 종료일을 지나면 발송을 안 했어도 명단에서 빠진다", () => {
    const r = dispatchScheduleForSlot(slot, 4, 종료일이후);
    expect(r.excluded).toBe(true);
  });

  it("발송 수를 주면 결제분을 다 보낼 때까지 명단에 남는다", () => {
    const r = dispatchScheduleForSlot(slot, 4, 종료일이후, 9);
    expect(r.excluded).toBe(false);
    expect(r.total).toBe(16);
    expect(r.remaining).toBe(7);
  });

  it("결제분을 다 보내면 그때 소진된다", () => {
    const r = dispatchScheduleForSlot(slot, 4, 종료일이후, 16);
    expect(r.excluded).toBe(true);
    expect(r.remaining).toBe(0);
  });

  // ★ 이 한 건이 '날짜 판정'과 '발송 수 판정'을 실제로 가른다.
  //   기록이 밀렸다가 한꺼번에 채워지면 달력 종료일보다 먼저 결제분을 다 채울 수 있다.
  //   그때 날짜만 보면 아직 종료일 전이라 계속 명단에 올라 과배송이 된다.
  it("달력 종료일 전이라도 결제분을 다 보냈으면 더 보내지 않는다(과배송 차단)", () => {
    const 종료일이전 = "2026-08-24"; // 16회차 예정일보다 한참 앞
    expect(dispatchScheduleForSlot(slot, 4, 종료일이전).excluded).toBe(false); // 날짜만 보면 발송 대상
    expect(dispatchScheduleForSlot(slot, 4, 종료일이전, 16).excluded).toBe(true); // 다 보냈으면 끝
  });

  it("해지·정지는 발송 수와 무관하게 계속 제외된다", () => {
    expect(dispatchScheduleForSlot({ ...slot, status: "해지" }, 4, 종료일이후, 9).excluded).toBe(true);
    expect(dispatchScheduleForSlot({ ...slot, paused: true }, 4, 종료일이후, 9).excluded).toBe(true);
  });

  it("시작일 이전은 여전히 제외된다", () => {
    expect(dispatchScheduleForSlot(slot, 4, "2026-06-01", 0).excluded).toBe(true);
  });

  it("미지정이면 옛 동작 그대로", () => {
    const 옛 = dispatchScheduleForSlot(slot, 4, 종료일이후);
    expect(dispatchScheduleForSlot(slot, 4, 종료일이후, null)).toEqual(옛);
  });
});
