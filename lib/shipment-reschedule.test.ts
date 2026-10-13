import { describe, it, expect } from "vitest";
import {
  checkRescheduleTarget,
  indexReschedules,
  rescheduleKey,
  formatShortDate,
  RESCHEDULE_MAX_DAYS,
  type ShipmentReschedule,
} from "./shipment-reschedule";

// 2026-10-19(월) 예정 회차를 기준으로 본다. 10/09(금)은 한글날(공휴일).
const FROM = "2026-10-19";

describe("checkRescheduleTarget — 서버 RPC 와 같은 규칙", () => {
  it("같은 주 평일로는 옮길 수 있다(미루기·앞당김 모두)", () => {
    expect(checkRescheduleTarget(FROM, "2026-10-21")).toEqual({ ok: true }); // 수
    expect(checkRescheduleTarget(FROM, "2026-10-16")).toEqual({ ok: true }); // 전주 금(-3일)
  });

  it("같은 날짜는 거부한다", () => {
    expect(checkRescheduleTarget(FROM, FROM).ok).toBe(false);
  });

  it("±6일을 넘기면 거부한다 — 앞뒤 회차와 같은 주에 겹친다", () => {
    expect(checkRescheduleTarget(FROM, "2026-10-26").ok).toBe(false); // +7 다음 회차 자리
    expect(checkRescheduleTarget(FROM, "2026-10-12").ok).toBe(false); // -7 직전 회차 자리
    expect(checkRescheduleTarget(FROM, "2026-10-23")).toEqual({ ok: true }); // +4 금
    expect(RESCHEDULE_MAX_DAYS).toBe(6);
  });

  it("주말·공휴일·목장 휴무일은 거부한다", () => {
    expect(checkRescheduleTarget(FROM, "2026-10-17").ok).toBe(false); // 토
    expect(checkRescheduleTarget(FROM, "2026-10-18").ok).toBe(false); // 일
    expect(checkRescheduleTarget("2026-10-05", "2026-10-09").ok).toBe(false); // 한글날
    expect(checkRescheduleTarget("2026-09-29", "2026-09-25").ok).toBe(false); // 추석 주 목장 휴무
  });

  it("날짜가 비었거나 형식이 틀리면 거부한다", () => {
    expect(checkRescheduleTarget(FROM, "").ok).toBe(false);
    expect(checkRescheduleTarget(FROM, "2026-13-40").ok).toBe(false);
  });
});

describe("indexReschedules", () => {
  const rows: ShipmentReschedule[] = [
    { order_id: "o1", delivery_day: "mon", from_date: "2026-10-19", to_date: "2026-10-21" },
    { order_id: "o2", delivery_day: "tue", from_date: "2026-10-20", to_date: "2026-10-21" },
  ];

  it("예정일에서 빠질 키와 새 날짜로 들어올 (주문·요일 → 예정일)을 만든다", () => {
    const idx = indexReschedules(rows);
    expect(idx.movedAway.has(rescheduleKey("o1", "mon", "2026-10-19"))).toBe(true);
    expect(idx.movedAway.has(rescheduleKey("o1", "mon", "2026-10-26"))).toBe(false);
    const here = idx.movedTo.get("2026-10-21");
    expect(here?.get("o1|mon")).toBe("2026-10-19");
    expect(here?.get("o2|tue")).toBe("2026-10-20");
    expect(idx.movedTo.get("2026-10-19")).toBeUndefined();
  });

  it("입력이 없으면 빈 인덱스다(기존 동작 그대로)", () => {
    const idx = indexReschedules(undefined);
    expect(idx.movedAway.size).toBe(0);
    expect(idx.movedTo.size).toBe(0);
  });
});

describe("formatShortDate", () => {
  it("M/D(요일) 로 적는다", () => {
    expect(formatShortDate("2026-10-19")).toBe("10/19(월)");
  });
});
