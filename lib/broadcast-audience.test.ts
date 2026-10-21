import { describe, it, expect } from "vitest";
import { buildBroadcastAudience, type AudienceEntry } from "./broadcast-audience";

// 2026-10-22(목) 기준. 7일치면 목·금·월·화·수가 한 번씩 들어온다.
const TODAY = "2026-10-22";

function entry(day: AudienceEntry["day"], userId: string | null, kind: AudienceEntry["kind"] = "정기"): AudienceEntry {
  return { kind, day, order: { user_id: userId } };
}

/** 날짜 → 그날 명단. 지정하지 않은 날짜는 빈 명단. */
function roster(byDate: Record<string, AudienceEntry[]>) {
  return (iso: string) => byDate[iso] ?? [];
}

describe("buildBroadcastAudience", () => {
  it("요일 필터는 그 날짜 배송 명단에 실제로 들어간 사람만 담는다", () => {
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({
        "2026-10-28": [entry("wed", "u-wed")], // 다음 수요일
        "2026-10-22": [entry("thu", "u-thu")],
      }),
      slots: [],
    });
    expect([...a.dayUserIds.get("wed")!]).toEqual(["u-wed"]);
    expect([...a.dayUserIds.get("thu")!]).toEqual(["u-thu"]);
    expect([...a.activeUserIds].sort()).toEqual(["u-thu", "u-wed"]);
  });

  it("회차를 다 쓴 구독자는 명단에 없으므로 수신자에서도 빠진다", () => {
    // 실사고(2026-10-22): slot.status 가 '활성'으로 남아 7월에 끝난 구독자까지 잡혔다.
    //   명단(buildRosterForDate)은 소진 구독을 이미 제외한다 — 그대로 따라간다.
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({ "2026-10-28": [entry("wed", "u-live")] }),
      // 소진됐지만 상태만 '활성'으로 남은 슬롯. 명단에 없으니 잡히면 안 된다.
      slots: [{ user_id: "u-usedup", status: "활성", paused: false }],
    });
    expect(a.dayUserIds.get("wed")!.has("u-usedup")).toBe(false);
    expect(a.activeUserIds.has("u-usedup")).toBe(false);
    expect(a.activeUserIds.has("u-live")).toBe(true);
  });

  it("단품 주문은 요일 필터에 들어가지 않는다 — 요일이 붙어 있어도", () => {
    // 지금은 단품의 day 가 언제나 null 이지만, 그 불변식이 깨져도 구독 요일 필터가
    //   오염되면 안 된다. kind 로도 막는다(요일 안내 문자가 단품 손님에게 갈 수 없게).
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({
        "2026-10-23": [
          entry(null, "u-once", "단품"),
          entry("fri", "u-once-with-day", "단품"),
          entry("fri", "u-sub"),
        ],
      }),
      slots: [],
    });
    expect([...a.dayUserIds.get("fri")!]).toEqual(["u-sub"]);
    expect(a.activeUserIds.has("u-once")).toBe(false);
    expect(a.activeUserIds.has("u-once-with-day")).toBe(false);
  });

  it("정지 중인 구독자는 요일 필터에선 빠지고 활성 구독자로는 닿는다", () => {
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({}), // 정지 중이면 어느 날짜 명단에도 없다
      slots: [{ user_id: "u-paused", status: "활성", paused: true }],
    });
    for (const d of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(a.dayUserIds.get(d)!.has("u-paused")).toBe(false);
    }
    expect(a.activeUserIds.has("u-paused")).toBe(true);
  });

  it("해지된 슬롯은 정지 플래그가 있어도 활성 수신자가 아니다", () => {
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({}),
      slots: [{ user_id: "u-cancelled", status: "해지", paused: true }],
    });
    expect(a.activeUserIds.has("u-cancelled")).toBe(false);
  });

  it("7일 창이 월~금을 한 번씩 덮는다", () => {
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({
        "2026-10-26": [entry("mon", "u-mon")],
        "2026-10-27": [entry("tue", "u-tue")],
        "2026-10-28": [entry("wed", "u-wed")],
        "2026-10-22": [entry("thu", "u-thu")],
        "2026-10-23": [entry("fri", "u-fri")],
      }),
      slots: [],
    });
    expect(a.activeUserIds.size).toBe(5);
    for (const d of ["mon", "tue", "wed", "thu", "fri"] as const) {
      expect(a.dayUserIds.get(d)!.size).toBe(1);
    }
  });

  it("회원 id 가 없는 주문(비회원 단건)은 건너뛴다", () => {
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({ "2026-10-23": [entry("fri", null)] }),
      slots: [],
    });
    expect(a.dayUserIds.get("fri")!.size).toBe(0);
    expect(a.activeUserIds.size).toBe(0);
  });

  it("공휴일로 발송일이 밀려도 그 회차의 요일로 잡힌다", () => {
    // 월요일분이 화요일에 나가는 주 — 명단이 day='mon' 으로 내보내므로 월요일 필터에 남는다.
    const a = buildBroadcastAudience({
      todayISO: TODAY,
      rosterForDate: roster({ "2026-10-27": [entry("mon", "u-shifted")] }),
      slots: [],
    });
    expect(a.dayUserIds.get("mon")!.has("u-shifted")).toBe(true);
    expect(a.dayUserIds.get("tue")!.size).toBe(0);
  });
});
