import { describe, it, expect } from "vitest";
import { buildRosterMaps } from "./roster-maps";
import { buildDispatchSlicesForDate } from "./dispatch-queue";
import { dispatchScheduleForSlot } from "./dispatch-schedule";
import { deliveryDayHitsDate } from "./ship-date";
import type { DeliveryDay } from "./cart";

// ─────────────────────────────────────────────────────────────────────────────
// 구독의 절대 불변식 — 돈이 걸린 규칙이라 예외가 없어야 한다.
//
//   ① 결제한 회차 수 = 실제 발송 횟수.  한 번이라도 더 나가면 손해, 덜 나가면 클레임이다.
//   ② 같은 날짜에 같은 구독이 두 번 잡히지 않는다(이중 발송).
//   ③ 배송 시트와 기간별 배송 명단은 언제나 같은 명단이다.
//   ④ 발송일은 항상 평일이고, 공휴일·목장 휴무일이 아니다(신선식품 — 창고에 묶이면 상한다).
//
// 공휴일 시프트·하계휴무 이월·일시정지·연장·요일변경이 겹쳐도 위 넷은 깨지면 안 된다.
// 아래는 그 조합을 날짜별로 전수 훑어 확인한다.
// ─────────────────────────────────────────────────────────────────────────────

type O = {
  id: string;
  status: string;
  order_type: string;
  block_weeks: number | null;
  shipping_fee: number | null;
  created_at: string;
  ship_date: string | null;
  ship_name: string;
  delivery_method: string | null;
  renews_slot_id: number | null;
  shipped_at: string | null;
};
type I = {
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: DeliveryDay | null;
  qty: number;
  unit_price: number;
};
type S = {
  id: number;
  order_id: string | null;
  status: string;
  started_at: string | null;
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
  delivery_day: string | null;
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// startISO 부터 days 일 동안의 모든 날짜.
function everyDay(startISO: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(startISO, i));
}

// 한 구독의 전 생애를 날짜별로 훑으며 '실제로 발송'까지 시뮬레이션한다.
//   운영과 같은 순서: 그날 시트를 뽑고 → 나갈 행을 출고하면 회차 이력(shipment_log)이 쌓인다.
//   과배송 방어선은 그 이력을 보고 판단하므로, 이력을 쌓아야 실제 동작과 같아진다.
function simulateLifetime(cfg: {
  day: DeliveryDay;
  anchor: string;
  weeks: number;
  renewalWeeks?: number; // 연장 결제(별도 주문 1건)
  firstShipDate?: string | null;
  pausedDays?: number;
  status?: string;
}): { dates: string[]; blocked: string[]; total: number } {
  const renewal = cfg.renewalWeeks ?? 0;
  const total = cfg.weeks + renewal;
  const base = (over: Partial<O> & { id: string }): O => ({
    status: "배송완료", // 회차를 도착확인한 뒤의 상태 — 그래도 남은 회차는 나가야 한다
    order_type: "구독",
    block_weeks: cfg.weeks,
    shipping_fee: 0,
    created_at: `${cfg.anchor}T00:00:00Z`,
    ship_date: null,
    ship_name: "손님",
    delivery_method: "택배",
    renews_slot_id: null,
    shipped_at: null,
    ...over,
  });
  const orders: O[] = [base({ id: "o1" })];
  const items: I[] = [
    { order_id: "o1", product_name: "송영신우유", volume: "180ml", delivery_day: cfg.day, qty: 1, unit_price: 3000 },
  ];
  if (renewal > 0) {
    orders.push(
      base({
        id: "o2",
        block_weeks: renewal,
        renews_slot_id: 1,
        created_at: `${cfg.anchor}T01:00:00Z`,
      })
    );
    items.push({
      order_id: "o2",
      product_name: "송영신우유",
      volume: "180ml",
      delivery_day: cfg.day,
      qty: 1,
      unit_price: 3000,
    });
  }
  const slots: S[] = [
    {
      id: 1,
      order_id: "o1",
      status: cfg.status ?? "활성",
      started_at: cfg.anchor,
      first_ship_date: cfg.firstShipDate ?? null,
      paused: false,
      paused_at: null,
      paused_days: cfg.pausedDays ?? 0,
      extended_weeks: renewal,
      delivery_day: cfg.day,
    },
  ];
  const maps = buildRosterMaps(orders, items, slots);
  // 출고 이력 — 하루씩 진행하며 실제로 쌓인다(`주문id|발송일`).
  const shippedKeys = new Set<string>();
  const span = total * 7 + 120 + (cfg.pausedDays ?? 0);
  const dates: string[] = [];
  const blocked: string[] = [];
  for (const d of everyDay(cfg.anchor, span)) {
    const rows = buildDispatchSlicesForDate({
      dateISO: d,
      orders,
      items,
      itemsByOrder: maps.itemsByOrder,
      maps: { ...maps, shippedKeys },
    });
    // ② 같은 날 같은 구독이 두 번 잡히면 이중 발송이다.
    expect(rows.length, `${d} 에 같은 구독이 ${rows.length}건 잡힘`).toBeLessThanOrEqual(1);
    for (const r of rows) {
      if (r.overPaidRounds) {
        blocked.push(d);
        continue; // 방어선이 막았다 — 출고하지 않는다
      }
      shippedKeys.add(`${r.order.id}|${r.shipISO}`);
      dates.push(d);
    }
  }
  return { dates, blocked, total };
}

const isWeekend = (iso: string) => {
  const wd = new Date(`${iso}T00:00:00`).getDay();
  return wd === 0 || wd === 6;
};

// 2026년 공휴일·목장 휴무(신선식품이라 발송 불가일) — lib/holidays 와 같은 날짜.
const BLOCKED = new Set([
  "2026-08-15",
  "2026-08-17",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-09-28",
  "2026-10-03",
  "2026-10-05",
  "2026-10-09",
  "2026-12-25",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
]);

// 앵커 요일·시작 시점을 바꿔 가며 여러 구독 형태를 만든다.
//   2026-06 ~ 2026-10 은 광복절 대체공휴일(8/17)·하계휴무(8/10~14)·추석(9/24~28)·
//   개천절 대체(10/5)·한글날(10/9)이 모두 들어 있어 시프트·이월이 전부 걸린다.
const CASES: {
  name: string;
  day: DeliveryDay;
  anchor: string;
  weeks: number;
  renewalWeeks?: number;
  firstShipDate?: string | null;
  pausedDays?: number;
}[] = [
  { name: "월요일 4주 (하계휴무 통과)", day: "mon", anchor: "2026-07-06", weeks: 4 },
  { name: "월요일 12주 (휴무+공휴일 다중)", day: "mon", anchor: "2026-06-08", weeks: 12 },
  { name: "월요일 8주 + 연장 8주", day: "mon", anchor: "2026-06-08", weeks: 8, renewalWeeks: 8 },
  { name: "화요일 12주", day: "tue", anchor: "2026-06-09", weeks: 12 },
  { name: "수요일 12주", day: "wed", anchor: "2026-06-10", weeks: 12 },
  { name: "목요일 12주 (하계휴무 목요일분)", day: "thu", anchor: "2026-06-11", weeks: 12 },
  { name: "금요일 12주", day: "fri", anchor: "2026-06-12", weeks: 12 },
  { name: "월요일 4주 · 앵커가 공휴일(8/17)", day: "mon", anchor: "2026-08-17", weeks: 4, firstShipDate: "2026-08-18" },
  { name: "목요일 4주 · 앵커가 목장 휴무일(8/13)", day: "thu", anchor: "2026-08-13", weeks: 4, firstShipDate: "2026-08-20" },
  { name: "월요일 8주 · 정지 7일", day: "mon", anchor: "2026-06-08", weeks: 8, pausedDays: 7 },
  { name: "월요일 8주 · 정지 28일", day: "mon", anchor: "2026-06-08", weeks: 8, pausedDays: 28 },
  { name: "추석 주 걸치는 목요일 12주", day: "thu", anchor: "2026-07-16", weeks: 12 },
];

describe("구독 불변식 — 결제한 회차만큼 정확히 나간다", () => {
  for (const c of CASES) {
    it(`${c.name}: 발송 횟수 = 결제 회차, 중복 없음, 발송일은 영업일`, () => {
      const { dates, total } = simulateLifetime(c);

      // ① 결제한 회차 수 = 실제 발송 횟수
      expect(dates.length, `발송일: ${dates.join(", ")}`).toBe(total);

      // ② 같은 날 두 번 없음(위에서 건별로도 확인) + 날짜가 모두 다름
      expect(new Set(dates).size).toBe(dates.length);

      // ④ 발송일은 평일이고 공휴일·목장 휴무일이 아니다
      for (const d of dates) {
        expect(isWeekend(d), `${d} 는 주말인데 발송으로 잡힘`).toBe(false);
        expect(BLOCKED.has(d), `${d} 는 공휴일·휴무일인데 발송으로 잡힘`).toBe(false);
      }

      // 발송일은 항상 앞으로만 간다(같은 날 두 번·역행 없음).
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] > dates[i - 1], `${dates[i - 1]} → ${dates[i]} 역행`).toBe(true);
      }
    });
  }

  it("1회차 보정일(first_ship_date)이 있어도 없어도 발송일이 같다", () => {
    // 저장된 보정일은 앵커에서 파생된 값이라, 있으나 없으나 회차 배송일이 같아야 한다.
    //   (한쪽만 보고 계산하는 코드가 생기면 여기서 깨진다 — 회차가 한 주 어긋나는 사고)
    const withFirst = simulateLifetime({
      day: "mon",
      anchor: "2026-08-17",
      weeks: 6,
      firstShipDate: "2026-08-18",
    });
    const without = simulateLifetime({ day: "mon", anchor: "2026-08-17", weeks: 6 });
    expect(withFirst.dates).toEqual(without.dates);
  });

  it("해지한 구독은 단 한 번도 나가지 않는다", () => {
    const { dates } = simulateLifetime({
      day: "mon",
      anchor: "2026-06-08",
      weeks: 12,
      status: "해지",
    });
    expect(dates).toEqual([]);
  });
});

describe("구독 불변식 — 명단 판정과 회차 판정이 갈리지 않는다", () => {
  it("로스터에 오른 날은 회차 계산도 '발송 대상'이라고 답해야 한다", () => {
    // 두 SSOT(deliveryDayHitsDate + 슬롯 스케줄)가 어긋나면 명단과 회차 표기가 갈린다.
    for (const c of CASES) {
      const slot = {
        status: "활성",
        started_at: c.anchor,
        first_ship_date: c.firstShipDate ?? null,
        paused: false,
        paused_at: null,
        paused_days: c.pausedDays ?? 0,
        extended_weeks: c.renewalWeeks ?? 0,
      };
      const { dates } = simulateLifetime(c);
      for (const d of dates) {
        expect(deliveryDayHitsDate(c.day, d).hits, `${c.name} ${d}: 요일 판정 불일치`).toBe(true);
        expect(
          dispatchScheduleForSlot(slot, c.weeks, d).excluded,
          `${c.name} ${d}: 회차 판정은 제외라는데 명단엔 올랐다`
        ).toBe(false);
      }
    }
  });

  it("회차 표기는 1부터 총 회차까지 빠짐없이 한 번씩 올라간다(정지 이력 없는 구독)", () => {
    for (const c of CASES) {
      if ((c.pausedDays ?? 0) > 0) continue; // 정지 이력 구독은 아래 별도 테스트에서 다룬다
      const slot = {
        status: "활성",
        started_at: c.anchor,
        first_ship_date: c.firstShipDate ?? null,
        paused: false,
        paused_at: null,
        paused_days: 0,
        extended_weeks: c.renewalWeeks ?? 0,
      };
      const { dates, total } = simulateLifetime(c);
      const rounds = dates.map((d) => dispatchScheduleForSlot(slot, c.weeks, d).round);
      expect(rounds, `${c.name}: 회차 표기 ${rounds.join(",")}`).toEqual(
        Array.from({ length: total }, (_, i) => i + 1)
      );
    }
  });

  it("회차 표기는 어떤 경우에도 뒤로 가거나 총 회차를 넘지 않는다", () => {
    for (const c of CASES) {
      const slot = {
        status: "활성",
        started_at: c.anchor,
        first_ship_date: c.firstShipDate ?? null,
        paused: false,
        paused_at: null,
        paused_days: c.pausedDays ?? 0,
        extended_weeks: c.renewalWeeks ?? 0,
      };
      const { dates, total } = simulateLifetime(c);
      const rounds = dates.map((d) => dispatchScheduleForSlot(slot, c.weeks, d).round);
      for (let i = 1; i < rounds.length; i++) {
        expect(rounds[i], `${c.name}: 회차가 뒤로 감 ${rounds.join(",")}`).toBeGreaterThanOrEqual(rounds[i - 1]);
      }
      for (const r of rounds) expect(r).toBeLessThanOrEqual(total);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 알려진 모델 결함 — 지금은 '과배송 방어선'이 손해를 막지만, 표기는 아직 어긋난다.
//   여기 적어 두는 이유: 조용히 넘어가면 다음 사람이 정상 동작으로 오해한다.
//   해당 구독은 관리자 '데이터 점검'에 뜨도록 해 두었다.
//   (연휴 몰림은 「한 회차는 그 주를 벗어나지 않는다」 규칙으로 해소됨 — 아래 회귀 테스트로 감시)
// ─────────────────────────────────────────────────────────────────────────────
describe("알려진 모델 결함(재발 감시용)", () => {
  it("[결함1] 일시정지 이력이 있으면 1회차가 두 번 표기되고 마지막 회차 번호에 도달하지 못한다", () => {
    // 원인: computeSchedule 이 정지일수를 '이미 나간 회차'까지 포함해 전 회차에 민다.
    //   정지는 '남은 회차만' 밀어야 한다. 그 결과 정지 전에 나간 회차가 모델에서 사라지고,
    //   회차 표기가 1,1,2,3… 으로 밀린다(발송 문자의 "N회 중 M번째"도 같은 값을 쓴다).
    //   실제 손해(과배송)는 아래 [방어선] 테스트대로 막힌다.
    const c = { day: "mon" as const, anchor: "2026-06-08", weeks: 8, pausedDays: 7 };
    const slot = {
      status: "활성",
      started_at: c.anchor,
      first_ship_date: null,
      paused: false,
      paused_at: null,
      paused_days: c.pausedDays,
      extended_weeks: 0,
    };
    const { dates, total } = simulateLifetime(c);
    const rounds = dates.map((d) => dispatchScheduleForSlot(slot, c.weeks, d).round);
    expect(dates.length).toBe(total); // 횟수는 맞다(방어선 덕분)
    expect(rounds[0]).toBe(1);
    expect(rounds[1]).toBe(1); // ← 결함: 1회차가 두 번
    expect(rounds[rounds.length - 1]).toBe(total - 1); // ← 결함: 마지막이 8이 아니라 7
  });

  it("[방어선] 정지 이력 구독도 결제 회차를 넘겨 나가지는 않는다", () => {
    for (const pausedDays of [7, 14, 28]) {
      const { dates, blocked, total } = simulateLifetime({
        day: "mon",
        anchor: "2026-06-08",
        weeks: 8,
        pausedDays,
      });
      expect(dates.length, `정지 ${pausedDays}일`).toBe(total);
      expect(blocked.length, `정지 ${pausedDays}일 — 방어선이 막은 초과분`).toBeGreaterThan(0);
    }
  });

  it("★회귀: 추석 연휴 주는 발송 없이 다음 주로 이월된다(두 회차 몰림 없음)", () => {
    // 옛 규칙('공휴일이면 다음 영업일')에서는 추석(9/24 목·9/25 금·9/28 월)분이 모두
    //   9/29(화)에 몰려 나가, 목요일 손님은 9/29 와 10/1 이 이틀 간격이었다(신선식품 과적).
    //   지금 규칙은 「한 회차는 그 주를 벗어나지 않는다」 — 그 주에 보낼 날이 없으면 그 회차를
    //   다음 주로 이월하고 뒤 회차 전체를 함께 민다. 회차는 사라지지 않는다.
    const { dates, total } = simulateLifetime({ day: "thu", anchor: "2026-07-16", weeks: 12 });
    expect(dates).not.toContain("2026-09-29");
    expect(dates).toContain("2026-09-17"); // 연휴 직전 회차
    expect(dates).toContain("2026-10-01"); // 이월된 회차
    expect(dates.length).toBe(total); // 이월해도 총 회차는 보존
    // 어떤 두 회차도 같은 주에 몰리지 않는다(간격 ≥ 7일).
    for (let i = 1; i < dates.length; i++) {
      const gap =
        (Date.parse(`${dates[i]}T00:00:00`) - Date.parse(`${dates[i - 1]}T00:00:00`)) / 86_400_000;
      expect(gap, `${dates[i - 1]} → ${dates[i]}`).toBeGreaterThanOrEqual(7);
    }
  });
});
