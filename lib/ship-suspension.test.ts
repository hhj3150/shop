import { describe, it, expect } from "vitest";
import { isShipSuspended, SUSPENDED_SHIP_DATES } from "./ship-suspension";
import { FARM_CLOSURES } from "./holidays";

describe("isShipSuspended — 배송이 없는 날엔 '내일 갑니다'를 보내지 않는다", () => {
  it("중단일을 가린다", () => {
    expect(isShipSuspended("2026-10-21")).toBe(true);
    expect(isShipSuspended("2026-10-22")).toBe(true);
    expect(isShipSuspended("2026-10-23")).toBe(true);
  });

  it("평소 날짜는 건드리지 않는다", () => {
    for (const d of ["2026-10-20", "2026-10-26", "2026-10-27", "2026-11-02"]) {
      expect(isShipSuspended(d), `${d} 가 막히면 안 된다`).toBe(false);
    }
  });

  // ★ 배송이 재개되는 날이 막히면 그날 예고가 안 나가고, 손님은 아무 안내 없이 받는다.
  it("재개일(10/26 월)은 열려 있다", () => {
    expect(isShipSuspended("2026-10-26")).toBe(false);
  });

  // ★ 이 스위치는 '예고만' 멈춘다. 같은 날짜를 FARM_CLOSURES 에도 넣으면 회차 일정이
  //   움직여(그 주에 영업일이 남아 있으면 이미 지난 요일로 당겨진다) 전혀 다른 사고가 된다.
  it("목장 휴무일 목록과 섞이지 않는다", () => {
    for (const d of SUSPENDED_SHIP_DATES) {
      expect(FARM_CLOSURES.has(d), `${d} 가 FARM_CLOSURES 에도 들어가 있다`).toBe(false);
    }
  });

  it("날짜 형식이 YYYY-MM-DD 다", () => {
    for (const d of SUSPENDED_SHIP_DATES) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
