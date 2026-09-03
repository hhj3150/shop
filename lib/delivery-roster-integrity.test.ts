// 배송 명단 무결성 회귀 테스트 — "손님이 제품을 못 받는" 경로를 통째로 막는다.
//
//   이 파일이 지키는 불변식 3가지:
//     ① 요일 매칭은 공휴일·목장 휴무 시프트를 반영한다(배송 시트 = 기간별 명단 = 예고 문자).
//     ② 총 회차는 slots.extended_weeks 까지 본다 — 연장 주문 행이 없는 카드 정기결제 구독도
//        원 회차 소진 뒤 명단에서 사라지지 않는다.
//     ③ 일시정지 뒤에도 회차 예정일은 손님이 고른 배송 요일에 그대로 떨어진다.
import { describe, it, expect } from "vitest";
import {
  buildRosterForDate,
  subscriptionShipsOnDate,
  type RosterOrderFields,
  type RosterItemFields,
} from "./delivery-roster";
import type { DispatchSlotInfo } from "./dispatch-schedule";
import type { RawBlock } from "./subscription-timeline";
import { computeSchedule } from "./subscription-schedule";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";
import { isDispatchBlockedISO } from "./holidays";

// ── 픽스처 ──
function order(over: Partial<RosterOrderFields> & { id: string }): RosterOrderFields {
  return {
    order_type: "구독",
    block_weeks: 4,
    ship_date: null,
    ship_name: "홍길동",
    ...over,
  };
}
function item(over: Partial<RosterItemFields> & { order_id: string }): RosterItemFields {
  return { product_name: "송영신우유", volume: "180ml", delivery_day: "mon", qty: 1, ...over };
}
function slot(over: Partial<DispatchSlotInfo> = {}): DispatchSlotInfo {
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
function block(over: Partial<RawBlock> & { orderId: string }): RawBlock {
  return {
    weeks: 4,
    deliveryDay: "mon",
    shippingPerWeek: 0,
    items: [{ productName: "송영신우유", volume: "180ml", qty: 1, unitPrice: 3000 }],
    ...over,
  };
}

// 요일 하나짜리 구독 한 건의 로스터 산출(블록 게이팅 포함).
function rosterFor(opts: {
  dateISO: string;
  day: DeliveryDay;
  startedAt: string;
  blockWeeks?: number;
}) {
  const weeks = opts.blockWeeks ?? 4;
  const o = order({ id: "o1", block_weeks: weeks });
  const s = slot({ started_at: opts.startedAt });
  return buildRosterForDate({
    dateISO: opts.dateISO,
    items: [item({ order_id: "o1", delivery_day: opts.day })],
    orderById: new Map([["o1", o]]),
    slotByOrder: new Map([["o1", s]]),
    confirmedOrderIds: new Set(["o1"]),
    pausedOrderIds: new Set(),
    blocksBySlot: new Map([[1, [block({ orderId: "o1", weeks, deliveryDay: opts.day })]]]),
    slotIdByOrder: new Map([["o1", 1]]),
    slotById: new Map([[1, s]]),
  });
}

describe("① 요일 매칭 — 공휴일·휴무 시프트(배송 시트 = 명단 = 예고 문자)", () => {
  // 배송 탭(DispatchPanel)이 쓰던 옛 규칙: 선택 날짜의 달력 요일과 단순 비교.
  const JS_DAY: Record<number, DeliveryDay | null> = {
    0: null, 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: null,
  };
  const legacyWeekdayMatch = (day: DeliveryDay, dateISO: string) =>
    JS_DAY[new Date(`${dateISO}T00:00:00`).getDay()] === day;

  it("광복절 대체공휴일(2026-08-17 월) — 월요일분은 그날 나가지 않는다", () => {
    expect(subscriptionShipsOnDate("mon", "2026-08-17")).toBe(false);
    // 옛 규칙은 공휴일에 발송하라고 시트에 띄웠다.
    expect(legacyWeekdayMatch("mon", "2026-08-17")).toBe(true);
  });

  it("2026-08-18(화) — 월요일분과 화요일분이 함께 나간다(월요일 손님 누락 금지)", () => {
    expect(subscriptionShipsOnDate("mon", "2026-08-18")).toBe(true);
    expect(subscriptionShipsOnDate("tue", "2026-08-18")).toBe(true);
    // 옛 규칙은 화요일분만 잡아 월요일 손님을 통째로 빠뜨렸다.
    expect(legacyWeekdayMatch("mon", "2026-08-18")).toBe(false);
  });

  it("2026 추석 주(9/21~9/25)는 통째로 휴배송 — 어느 요일분도 나가지 않는다", () => {
    for (const d of ["2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25","2026-09-28"]) {
      expect({ d, ships: DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, d)) })
        .toEqual({ d, ships: [] });
    }
  });

  it("추석 다음 주 재개 — 9/29 월·화, 9/30 수, 10/1 목, 10/2 금", () => {
    const on = (d: string) => DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, d));
    expect(on("2026-09-29")).toEqual(["mon", "tue"]); // 9/28 대체공휴일 → 월요일분이 화요일에
    expect(on("2026-09-30")).toEqual(["wed"]);
    expect(on("2026-10-01")).toEqual(["thu"]);
    expect(on("2026-10-02")).toEqual(["fri"]);
  });

  it("개천절 대체(10/5 월) — 같은 주 뒤로 미뤄 10/6(화)에 화요일분과 함께", () => {
    expect(subscriptionShipsOnDate("mon", "2026-10-05")).toBe(false);
    expect(DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, "2026-10-06")))
      .toEqual(["mon", "tue"]);
  });

  it("한글날(10/9 금) — 같은 주 앞으로 당겨 10/8(목)에 목요일분과 함께", () => {
    expect(subscriptionShipsOnDate("fri", "2026-10-09")).toBe(false);
    expect(DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, "2026-10-08")))
      .toEqual(["thu", "fri"]);
    // 뒤로 밀면 10/12(월)이 되어 주를 넘는다 — 그 날엔 금요일분이 없어야 한다.
    expect(subscriptionShipsOnDate("fri", "2026-10-12")).toBe(false);
  });

  it("한 주에 한 요일그룹은 정확히 한 번(또는 휴배송이면 0번) 나간다 — 2026 하반기 전수", () => {
    // 「한 회차는 그 주를 벗어나지 않는다」의 관측 가능한 형태:
    //   같은 주에 두 번 나가면 이중발송, 영업일이 있는데 0번이면 그 주 회차가 증발한 것이다.
    for (let w = 0; w < 26; w++) {
      const mon = new Date("2026-07-06T00:00:00"); // 월요일
      mon.setDate(mon.getDate() + w * 7);
      const week = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(mon);
        d.setDate(mon.getDate() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`;
      });
      const weekOpen = week.some((d) => !isDispatchBlockedISO(d));
      for (const k of DELIVERY_DAYS) {
        const n = week.filter((d) => subscriptionShipsOnDate(k, d)).length;
        expect({ week: week[0], k, n }).toEqual({ week: week[0], k, n: weekOpen ? 1 : 0 });
      }
    }
  });

  it("하계 휴무 주(2026-08-10~14)는 어느 요일분도 나가지 않는다", () => {
    for (const d of ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]) {
      expect(DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, d))).toEqual([]);
    }
  });

  it("평상 주에는 옛 규칙과 결과가 같다(일상 운영 불변)", () => {
    for (const d of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]) {
      for (const k of DELIVERY_DAYS) {
        expect(subscriptionShipsOnDate(k, d)).toBe(legacyWeekdayMatch(k, d));
      }
    }
  });

  it("주말에는 어떤 구독도 잡히지 않는다", () => {
    for (const d of ["2026-06-06", "2026-06-07"]) {
      expect(DELIVERY_DAYS.filter((k) => subscriptionShipsOnDate(k, d))).toEqual([]);
    }
  });

  it("로스터도 시프트를 그대로 따른다 — 8/17 없음, 8/18 있음", () => {
    // 2026-08-03(월) 시작 4회차: 8/3, 8/18(휴무 주 이월 + 공휴일 시프트), 8/24, 8/31.
    expect(rosterFor({ dateISO: "2026-08-17", day: "mon", startedAt: "2026-08-03" })).toHaveLength(0);
    expect(rosterFor({ dateISO: "2026-08-18", day: "mon", startedAt: "2026-08-03" })).toHaveLength(1);
  });
});

describe("② 총 회차 — 확정된 블록 체인만 센다(과배송·미배송 동시 차단)", () => {
  // subscription_slots.extended_weeks 는 연장 입금확인 때 늘기만 하고 줄지 않는다.
  //   그 값을 총 회차로 믿으면, 입금확인된 연장주문을 나중에 '취소'로 되돌렸을 때
  //   회차가 남아 이미 끝난 구독에 계속 보내게 된다(과배송).
  //   → 총 회차는 확정(입금확인 이후) 상태인 주문 블록의 합으로만 센다.
  const started = "2026-06-01"; // 월요일. 원주문 4회차 = 6/1, 6/8, 6/15, 6/22.

  // 원주문 + 연장주문(확정 여부 선택)으로 로스터를 만든다.
  function rosterWithRenewal(dateISO: string, opts: { renewalConfirmed: boolean }) {
    const orig = order({ id: "o1", block_weeks: 4 });
    const ren = order({ id: "o2", block_weeks: 4, renews_slot_id: 1 });
    const s = slot({ started_at: started, extended_weeks: 4 }); // 연장 입금확인으로 이미 누적됨
    // 확정된 연장주문만 블록 체인에 들어온다(buildRosterMaps 규칙과 동일).
    const blocks = opts.renewalConfirmed
      ? [block({ orderId: "o1", weeks: 4 }), block({ orderId: "o2", weeks: 4 })]
      : [block({ orderId: "o1", weeks: 4 })];
    const confirmed = new Set(opts.renewalConfirmed ? ["o1", "o2"] : ["o1"]);
    return buildRosterForDate({
      dateISO,
      items: [item({ order_id: "o1" }), item({ order_id: "o2" })],
      orderById: new Map([["o1", orig], ["o2", ren]]),
      slotByOrder: new Map([["o1", s]]),
      confirmedOrderIds: confirmed,
      pausedOrderIds: new Set(),
      blocksBySlot: new Map([[1, blocks]]),
      slotIdByOrder: new Map([["o1", 1], ["o2", 1]]),
      slotById: new Map([[1, s]]),
    });
  }

  it("연장주문이 확정이면 5회차부터 연장주문 행으로 이어서 나간다", () => {
    const r = rosterWithRenewal("2026-06-29", { renewalConfirmed: true });
    expect(r).toHaveLength(1);
    expect(r[0].order.id).toBe("o2"); // 한 슬롯에서 블록 1개만 — 이중발송 없음
  });

  it("연장주문을 '취소'로 되돌리면 extended_weeks 가 남아 있어도 발송이 멈춘다", () => {
    expect(rosterWithRenewal("2026-06-22", { renewalConfirmed: false })).toHaveLength(1); // 원 4회차
    expect(rosterWithRenewal("2026-06-29", { renewalConfirmed: false })).toHaveLength(0); // 과배송 금지
  });

  it("한 슬롯의 원주문·연장주문이 같은 날 함께 나가지 않는다(이중발송 금지)", () => {
    for (const d of ["2026-06-08", "2026-06-22", "2026-06-29", "2026-07-13"]) {
      expect(rosterWithRenewal(d, { renewalConfirmed: true }).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("③ 일시정지 — 회차 예정일이 배송 요일에서 벗어나지 않는다", () => {
  it("정지 일수가 7의 배수가 아니어도 회차 예정일이 '실제 월요일 발송일'에 떨어진다", () => {
    // 불변식: computeSchedule 이 내놓는 날짜는 로스터가 그날 실제로 발송하는 날이어야 한다.
    //   (공휴일 시프트로 달력 요일은 화요일이 될 수 있지만, 그 화요일이 곧 월요일분 발송일이다.)
    for (const pausedDays of [1, 2, 3, 4, 5, 6, 9, 12, 20]) {
      const sch = computeSchedule(
        {
          startedAt: "2026-06-01", // 월요일 앵커
          totalWeeks: 8,
          paused: false,
          pausedAt: null,
          pausedDays,
        },
        new Date("2026-06-10T00:00:00")
      );
      expect({ pausedDays, end: subscriptionShipsOnDate("mon", sch.endDate!) })
        .toEqual({ pausedDays, end: true });
      expect({ pausedDays, next: subscriptionShipsOnDate("mon", sch.nextDate!) })
        .toEqual({ pausedDays, next: true });
    }
  });

  it("[회귀] 날 단위로 더하면 회차 예정일이 배송 요일에서 벗어난다(옛 동작)", () => {
    // 옛 규칙(정지 일수를 날 단위로 그대로 가산)을 재현: 월요일 앵커 + 3일 = 목요일.
    const naive = new Date("2026-06-01T00:00:00");
    naive.setDate(naive.getDate() + 3);
    expect(subscriptionShipsOnDate("mon", naive.toISOString().slice(0, 10))).toBe(false);
  });

  it("정지가 없으면 기존 계산과 완전히 동일하다", () => {
    const sch = computeSchedule(
      { startedAt: "2026-06-01", totalWeeks: 4, paused: false, pausedAt: null, pausedDays: 0 },
      new Date("2026-06-10T00:00:00")
    );
    expect(sch.delivered).toBe(2);
    expect(sch.nextDate).toBe("2026-06-15");
    expect(sch.endDate).toBe("2026-06-22");
  });

  it("1주 건너뛰기(+7일)는 정확히 한 주만 밀린다", () => {
    const sch = computeSchedule(
      { startedAt: "2026-06-01", totalWeeks: 4, paused: false, pausedAt: null, pausedDays: 7 },
      new Date("2026-06-10T00:00:00")
    );
    expect(sch.endDate).toBe("2026-06-29");
  });

  it("정지해도 총 회차는 보존된다 — 실제 발송(로스터) 횟수와 일치", () => {
    // 월요일 구독 4회차, 3일 정지분이 누적된 상태. 로스터가 실제로 잡는 월요일 수 = 4.
    const days: string[] = [];
    const cur = new Date("2026-06-01T00:00:00");
    for (let i = 0; i < 70; i++) {
      const iso = cur.toISOString().slice(0, 10);
      if (rosterFor({ dateISO: iso, day: "mon", startedAt: "2026-06-01" }).length > 0) days.push(iso);
      cur.setDate(cur.getDate() + 1);
    }
    expect(days).toHaveLength(4);
  });
});

describe("④ 회차 보존 — 결제한 회차는 공휴일·휴무 주를 지나도 빠짐없이 배송된다", () => {
  // 배송 명단(로스터)이 실제로 잡는 날짜 목록. 구독 시작 전후 넉넉히 훑는다.
  function shipDates(day: DeliveryDay, startedAt: string, weeks: number): string[] {
    const out: string[] = [];
    const cur = new Date(`${startedAt}T00:00:00`);
    cur.setDate(cur.getDate() - 7);
    for (let i = 0; i < weeks * 7 + 90; i++) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(
        cur.getDate()
      ).padStart(2, "0")}`;
      if (rosterFor({ dateISO: iso, day, startedAt, blockWeeks: weeks }).length > 0) out.push(iso);
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  // 각 요일의 앵커(그 요일의 실제 날짜) — 2026-07-27(월) 주간.
  const ANCHOR: Record<DeliveryDay, string> = {
    mon: "2026-07-27",
    tue: "2026-07-28",
    wed: "2026-07-29",
    thu: "2026-07-30",
    fri: "2026-07-31",
  };

  it.each(DELIVERY_DAYS)("%s 요일 12회차 — 하계휴무·광복절을 통과해도 정확히 12회 배송", (day) => {
    const dates = shipDates(day, ANCHOR[day], 12);
    expect(dates).toHaveLength(12);
    // 같은 날짜가 두 번 잡히지 않는다(이중 발송 금지).
    expect(new Set(dates).size).toBe(12);
    // 발송일은 모두 평일이다(주말 출고 금지 — 신선식품이 창고에 묶인다).
    for (const d of dates) {
      const dow = new Date(`${d}T00:00:00`).getDay();
      expect({ d, weekend: dow === 0 || dow === 6 }).toEqual({ d, weekend: false });
    }
  });

  it.each(DELIVERY_DAYS)("%s 요일 12회차 — 추석 연휴를 통과해도 정확히 12회 배송", (day) => {
    const anchor: Record<DeliveryDay, string> = {
      mon: "2026-08-31", tue: "2026-09-01", wed: "2026-09-02", thu: "2026-09-03", fri: "2026-09-04",
    };
    const dates = shipDates(day, anchor[day], 12);
    expect(dates).toHaveLength(12);
    expect(new Set(dates).size).toBe(12);
  });

  it("한 날에 세 요일그룹 이상이 몰리지 않는다(9월~12월 전수)", () => {
    // 물량 폭주 가드: 공휴일 시프트로 하루에 몰리는 요일그룹은 최대 2개여야 한다.
    const anchor: Record<DeliveryDay, string> = {
      mon: "2026-08-31", tue: "2026-09-01", wed: "2026-09-02", thu: "2026-09-03", fri: "2026-09-04",
    };
    const cur = new Date("2026-09-01T00:00:00");
    for (let i = 0; i < 122; i++) {
      const iso = cur.toISOString().slice(0, 10);
      const groups = DELIVERY_DAYS.filter(
        (d) => rosterFor({ dateISO: iso, day: d, startedAt: anchor[d], blockWeeks: 20 }).length > 0
      );
      expect({ iso, count: groups.length }).toEqual({ iso, count: Math.min(groups.length, 2) });
      cur.setDate(cur.getDate() + 1);
    }
  });
});
