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
    // 06-08(월, 2회차 예정일) 정지 시작 → 그날 배송명단에서 빠지므로 06-01 1회만 완료.
    const s = computeSchedule(
      base({ paused: true, pausedAt: "2026-06-08" }),
      d("2026-06-22")
    );
    expect(s.paused).toBe(true);
    expect(s.nextDate).toBeNull();
    expect(s.delivered).toBe(1);
  });

  // ── 일시정지 회차 밀림 ──
  //   정지 보정의 기준은 '경과 일수'가 아니라 '놓친 회차 수'다. 경과 일수를 주 단위로
  //   올리면(옛 규칙) 배송을 하나도 놓치지 않은 정지가 전 회차를 한 주 밀고, 반대로
  //   휴배송 주를 낀 정지는 있지도 않은 배송을 놓친 것으로 세어 회차를 깎는다.
  describe("일시정지 — 놓친 회차만큼만 민다", () => {
    it("배송일이 끼지 않은 짧은 정지는 회차를 밀지 않는다", () => {
      // 월요일 구독. 06-03(수) 정지 → 06-05(금) 기준. 그 사이 배송 예정일은 없다.
      const s = computeSchedule(
        base({ paused: true, pausedAt: "2026-06-03" }),
        d("2026-06-05")
      );
      expect(s.delivered).toBe(1); // 06-01 1회차만 완료
      expect(s.endDate).toBe("2026-06-22"); // 종료일 그대로 — 옛 규칙은 06-29 로 밀었다
    });

    it("배송일이 한 번 낀 정지는 딱 한 주만 민다", () => {
      const s = computeSchedule(
        base({ paused: true, pausedAt: "2026-06-03" }),
        d("2026-06-10")
      );
      expect(s.delivered).toBe(1); // 06-08 회차를 놓쳤다
      expect(s.endDate).toBe("2026-06-29"); // 종료일 +1주
    });

    it("정지 중에는 delivered 가 날마다 흔들리지 않고 그대로 멈춘다", () => {
      const paused = base({ paused: true, pausedAt: "2026-06-03" });
      for (const iso of ["2026-06-05", "2026-06-08", "2026-06-12", "2026-06-16", "2026-06-23"]) {
        expect(computeSchedule(paused, d(iso)).delivered).toBe(1);
      }
    });

    it("휴배송 주(2026 추석)를 낀 정지는 그 주를 정지로 세지 않는다", () => {
      // 화요일 구독, 앵커 06-16 + 확정 정지 28일 → 9회차 09-15, 다음 회차는 추석 휴배송으로 09-29.
      const tue = {
        startedAt: "2026-06-16",
        totalWeeks: 12,
        paused: true,
        pausedAt: "2026-09-17",
        pausedDays: 28,
      };
      // 추석 주(09-21~25)는 원래 배송이 없는 주다 → 정지로 세면 안 된다.
      expect(computeSchedule(tue, d("2026-09-23")).endDate).toBe("2026-10-13");
      // 09-29 회차를 실제로 놓친 시점에야 한 주 밀린다.
      expect(computeSchedule(tue, d("2026-09-29")).endDate).toBe("2026-10-20");
    });

    it("재개 시점의 스케줄이 정지 중 화면과 이어진다(회차가 튀지 않는다)", () => {
      const tue = {
        startedAt: "2026-06-16",
        totalWeeks: 12,
        paused: true,
        pausedAt: "2026-09-17",
        pausedDays: 28,
      };
      const whilePaused = computeSchedule(tue, d("2026-09-29"));
      // 재개 RPC 는 [정지일, 재개일) 의 놓친 회차 1건 → paused_days += 7.
      const afterResume = computeSchedule(
        { ...tue, paused: false, pausedAt: null, pausedDays: 35 },
        d("2026-09-30")
      );
      expect(afterResume.delivered).toBe(whilePaused.delivered);
      expect(afterResume.endDate).toBe(whilePaused.endDate);
      expect(afterResume.nextDate).toBe("2026-10-06");
    });
  });

  it("연장(totalWeeks=8) → 5회차 시점 delivered 5, remaining 3", () => {
    const s = computeSchedule(base({ totalWeeks: 8 }), d("2026-06-29"));
    expect(s.delivered).toBe(5);
    expect(s.remaining).toBe(3);
    expect(s.endDate).toBe("2026-07-20");
  });

  // ── 첫배송이 공휴일에 걸릴 때 ──
  //    앵커(started_at, 선택 요일)는 그대로 두고 1회차 발송일만 규칙(shipDateInWeek)으로 정한다.
  //    slots.first_ship_date 는 더 이상 쓰지 않는다 — 옛 규칙('다음 영업일')로 저장된 값이라
  //    앞당김·휴배송이 들어간 지금 규칙과 어긋나고, 그러면 회차 계산과 배송 명단이 갈린다.
  describe("첫배송 공휴일 — 앵커에서 규칙대로 산출", () => {
    it("월요일 공휴일 앵커(10-05 개천절 대체) → 1회차는 같은 주 10-06(화)", () => {
      const s = computeSchedule(
        base({ startedAt: "2026-10-05", totalWeeks: 4 }),
        d("2026-10-05")
      );
      expect(s.delivered).toBe(0); // 앵커 당일은 공휴일 — 아직 발송 전
      expect(s.nextDate).toBe("2026-10-06");
    });

    it("시프트된 첫배송일(10-06) — delivered 1, 2회차는 앵커 요일 10-12", () => {
      const s = computeSchedule(
        base({ startedAt: "2026-10-05", totalWeeks: 4 }),
        d("2026-10-06")
      );
      expect(s.delivered).toBe(1);
      expect(s.nextDate).toBe("2026-10-12");
      expect(s.endDate).toBe("2026-10-26"); // 2회차+ 는 앵커 요일 cadence 유지
    });

    it("first_ship_date 가 저장돼 있어도 무시하고 앵커에서 산출한다", () => {
      const withStale = computeSchedule(
        base({ startedAt: "2026-10-05", totalWeeks: 4, firstShipDate: "2026-10-09" }),
        d("2026-10-06")
      );
      expect(withStale.delivered).toBe(1);
      expect(withStale.nextDate).toBe("2026-10-12");
    });

    it("금요일 공휴일 앵커는 1회차를 앞당기지 않고 다음 주로 미룬다", () => {
      // 2026-12-25(금) 성탄절. 앞당기면 12-24(목) — 앵커(입금확인 다음 날 이후)보다 이르다.
      //   2027-01-01(금)도 신정이라 한 주 더 미뤄 1/8 이 1회차가 된다.
      const s = computeSchedule(
        base({ startedAt: "2026-12-25", totalWeeks: 4 }),
        d("2026-12-25")
      );
      expect(s.delivered).toBe(0);
      expect(s.nextDate).toBe("2027-01-08");
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

describe("2026 하절기 휴가(8/9~8/17) — 그 주 회차 이월", () => {
  // 휴무로 그 주 발송일이 없으면 회차를 다음 주 같은 요일로 이월한다(총 회차 보존).
  // 다음 영업일(8/18)로 몰면 월·화는 연속 두 회차가 8/18 하나로 뭉개져 한 회차가 사라졌다.
  const dates = (anchor: string, n: number): string[] =>
    Array.from({ length: n }, (_, i) =>
      computeSchedule(
        { startedAt: anchor, firstShipDate: null, totalWeeks: i + 1, paused: false, pausedAt: null, pausedDays: 0 },
        new Date("2030-01-01T00:00:00")
      ).endDate as string
    );

  it("월요일 구독 — 8/3 다음은 8/18, 그 다음은 8/24 (회차 소실 없음)", () => {
    expect(dates("2026-07-06", 8)).toEqual([
      "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27",
      "2026-08-03", "2026-08-18", "2026-08-24", "2026-08-31",
    ]);
  });

  it("화요일 구독 — 8/4 다음은 8/18(월요일분과 같은 날), 그 다음은 8/25", () => {
    expect(dates("2026-07-07", 8)).toEqual([
      "2026-07-07", "2026-07-14", "2026-07-21", "2026-07-28",
      "2026-08-04", "2026-08-18", "2026-08-25", "2026-09-01",
    ]);
  });

  it("수·목·금 구독은 휴무 다음 주 제 요일(8/19·8/20·8/21)로 이월", () => {
    expect(dates("2026-07-08", 6)[5]).toBe("2026-08-19"); // 수
    expect(dates("2026-07-09", 6)[5]).toBe("2026-08-20"); // 목
    expect(dates("2026-07-10", 6)[5]).toBe("2026-08-21"); // 금
  });

  it("총 회차는 보존되고 배송일이 겹치지 않는다(전 요일)", () => {
    for (const anchor of ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]) {
      const ds = dates(anchor, 12);
      expect(new Set(ds).size, `중복 발송일: ${anchor} → ${ds}`).toBe(12);
    }
  });

  it("휴무 기간에는 배송일이 잡히지 않는다", () => {
    const closed = new Set(["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-17"]);
    for (const anchor of ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"]) {
      for (const d of dates(anchor, 12)) expect(closed.has(d), `${anchor} → ${d}`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 실제 발송 수 기준 진행도 (shippedCount)
//
//   [사고] 2026-10, 박재우 님. 6/08 시작·원주문 4주 → 4회 수령. 연장 입금이 8/08 이라
//     7/06~8/10 다섯 주는 배송이 없었다(미결제 블록은 명단에 안 나간다 — 정상).
//     그런데 회차 커서가 날짜로 전진해 그 빈 다섯 주를 5~9회차로 먹었다.
//     8/08 에 결제한 12주(5~16회차)가 10/06 에 끝나는 것으로 계산돼, 12회 중 7회만
//     받게 되고 그 상태로 재구독 안내가 나가 손님이 또 결제했다.
//   [규칙] 결제한 회차는 날짜가 밀려도 전부 나간다. 진행도는 실제 발송 수가 정한다.
// ─────────────────────────────────────────────────────────────────────────────
describe("computeSchedule — 실제 발송 수 기준(shippedCount)", () => {
  const 박재우 = {
    startedAt: "2026-06-08", // 월요일 앵커
    totalWeeks: 16, // 원주문 4주 + 연장 12주
    paused: false,
    pausedAt: null,
    pausedDays: 0,
  };
  const 오늘 = new Date(2026, 9, 5); // 2026-10-05

  it("옛 방식: 공백 주를 배송으로 세어 진행도가 부풀고 종료일이 당겨진다", () => {
    const sch = computeSchedule(박재우, 오늘);
    expect(sch.delivered).toBeGreaterThan(9); // 실제 9회인데 달력은 더 센다
    expect(sch.remaining).toBeLessThan(7);
  });

  it("실제 발송 수를 주면 진행도가 사실과 같아진다", () => {
    const sch = computeSchedule({ ...박재우, shippedCount: 9 }, 오늘);
    expect(sch.delivered).toBe(9);
    expect(sch.remaining).toBe(7); // 16 - 9
    expect(sch.done).toBe(false);
  });

  it("남은 회차가 오늘 이후로 밀려 결제분이 전부 나간다", () => {
    const sch = computeSchedule({ ...박재우, shippedCount: 9 }, 오늘);
    expect(sch.nextDate).not.toBeNull();
    expect(sch.nextDate! >= "2026-10-05").toBe(true); // 지나간 날짜로 잡지 않는다
    expect(sch.endDate! > "2026-10-06").toBe(true); // 옛 계산(10/06)보다 뒤로 밀린다
  });

  it("종료일은 '남은 회차만큼' 뒤로 간다 — 회차가 증발하지 않는다", () => {
    const a = computeSchedule({ ...박재우, shippedCount: 9 }, 오늘);
    const b = computeSchedule({ ...박재우, shippedCount: 10 }, 오늘);
    // 한 회 더 받았으면 종료일이 한 주 앞당겨진다(남은 회차가 하나 줄었으므로).
    expect(b.endDate! < a.endDate!).toBe(true);
  });

  it("결제분을 다 받으면 완료 — 남은 회차 0, 다음 배송 없음", () => {
    const sch = computeSchedule({ ...박재우, shippedCount: 16 }, 오늘);
    expect(sch.delivered).toBe(16);
    expect(sch.remaining).toBe(0);
    expect(sch.done).toBe(true);
    expect(sch.nextDate).toBeNull();
  });

  it("기록이 총 회차를 넘어도 결제분까지만 센다(중복 기록 방어)", () => {
    const sch = computeSchedule({ ...박재우, shippedCount: 99 }, 오늘);
    expect(sch.delivered).toBe(16);
    expect(sch.remaining).toBe(0);
  });

  it("음수·소수 기록은 안전하게 정리한다", () => {
    expect(computeSchedule({ ...박재우, shippedCount: -3 }, 오늘).delivered).toBe(0);
    expect(computeSchedule({ ...박재우, shippedCount: 9.7 }, 오늘).delivered).toBe(9);
  });

  it("정지 중이면 다음 배송일은 비운다(남은 회차는 보존)", () => {
    const sch = computeSchedule(
      { ...박재우, shippedCount: 9, paused: true, pausedAt: "2026-09-30" },
      오늘
    );
    expect(sch.nextDate).toBeNull();
    expect(sch.remaining).toBe(7);
  });

  it("미지정이면 옛 방식 그대로 — 호출처를 옮기기 전까지 동작이 변하지 않는다", () => {
    const 옛 = computeSchedule(박재우, 오늘);
    const 명시없음 = computeSchedule({ ...박재우, shippedCount: null }, 오늘);
    expect(명시없음).toEqual(옛);
  });
});
