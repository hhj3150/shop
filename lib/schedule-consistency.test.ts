// 정기구독 배송일의 '한 벌' 보장 — 계정/환불(computeSchedule)이 말하는 날짜와
//   실제 발송 명단·전날 예고 문자(deliveryDayHitsDate + dispatchScheduleForSlot)가 같아야 한다.
//
//   두 계산은 출발점이 다르다.
//     · computeSchedule : 앵커(started_at) + (k-1)주 + 누적 정지일 + 누적 이월
//     · 로스터/예고문자 : 주문 품목의 delivery_day '요일'에 해당하는 날 (정지일수를 보지 않는다)
//   정지 적립이 7의 배수인 한 두 결과는 항상 일치한다. 배수가 아니면 앵커 요일이 밀려
//   계정 화면만 혼자 다른 요일을 말하게 된다 — 그래서 정지 적립을 주 단위로 정렬한다
//   (SQL: resume_subscription / auto_resume_skips → missed_delivery_weeks × 7).
import { describe, it, expect } from "vitest";
import { computeSchedule } from "./subscription-schedule";
import { dispatchScheduleForSlot } from "./dispatch-schedule";
import { deliveryDayHitsDate, toISODate } from "./ship-date";

const ANCHORS: [string, string][] = [
  ["mon", "2026-06-08"],
  ["tue", "2026-06-09"],
  ["wed", "2026-06-10"],
  ["thu", "2026-06-11"],
  ["fri", "2026-06-12"],
];

// computeSchedule 이 내는 1..total 회차 배송일.
function scheduleDates(anchor: string, total: number, pausedDays: number): string[] {
  return Array.from({ length: total }, (_, i) =>
    computeSchedule(
      {
        startedAt: anchor,
        firstShipDate: null,
        totalWeeks: i + 1,
        paused: false,
        pausedAt: null,
        pausedDays,
      },
      new Date("2030-01-01T00:00:00")
    ).endDate as string
  );
}

// 로스터/예고문자가 [from, to] 구간에서 실제로 발송하는 날짜.
function rosterDates(
  day: string,
  anchor: string,
  total: number,
  pausedDays: number,
  from: string,
  to: string
): string[] {
  const slot = {
    status: "활성",
    started_at: anchor,
    first_ship_date: null,
    paused: false,
    paused_at: null,
    paused_days: pausedDays,
    extended_weeks: 0,
  };
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00`);
  while (toISODate(cur) <= to) {
    const iso = toISODate(cur);
    if (
      deliveryDayHitsDate(day, iso).hits &&
      !dispatchScheduleForSlot(slot, total, iso).excluded
    ) {
      out.push(iso);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

describe("계정·환불 == 발송 명단·예고 문자", () => {
  // 하계 휴무(8/9~8/17)와 추석 연휴(9/24~9/28)를 모두 지나는 길이로 잡는다.
  for (const [day, anchor] of ANCHORS) {
    for (const pausedDays of [0, 7, 14, 28]) {
      it(`${day} 구독 · 정지 ${pausedDays}일 — 20회차 날짜가 완전히 같다`, () => {
        const total = 20;
        const want = scheduleDates(anchor, total, pausedDays);
        // 비교 구간은 1회차부터 마지막 회차까지. 정지 적립분만큼 시작이 뒤로 밀리므로
        // 그 이전(앵커~1회차)은 이미 지나간 구간이라 대조 대상이 아니다.
        const got = rosterDates(day, anchor, total, pausedDays, want[0], want[total - 1]);
        expect(got).toEqual(want);
      });
    }
  }

  it("총 회차가 보존되고 배송일이 겹치지 않는다", () => {
    for (const [, anchor] of ANCHORS) {
      for (const pausedDays of [0, 7, 14, 28]) {
        const ds = scheduleDates(anchor, 20, pausedDays);
        expect(new Set(ds).size, `${anchor}/${pausedDays}: ${ds.join(",")}`).toBe(20);
        for (let i = 1; i < ds.length; i++) {
          expect(ds[i] > ds[i - 1], `${anchor}/${pausedDays}: ${ds[i - 1]}→${ds[i]}`).toBe(true);
        }
      }
    }
  });

  it("정지 적립이 7의 배수가 아니면 두 계산이 갈린다(주 단위 정렬이 필요한 이유)", () => {
    // 이 케이스가 실제로 프로덕션에 있었다(슬롯 39, 화요일 구독 + 정지 11일).
    // 회귀 방지용 — 서버가 이런 값을 만들지 않도록 정렬하는 것이 수정의 핵심이다.
    const want = scheduleDates("2026-06-09", 12, 11);
    const got = rosterDates("tue", "2026-06-09", 12, 11, want[0], want[11]);
    expect(got).not.toEqual(want);
    // 그래도 회차 소실은 없어야 한다(충돌 가드).
    expect(new Set(want).size).toBe(12);
  });
});
