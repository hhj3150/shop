import { describe, it, expect } from "vitest";
import { firstDeliveryOnOrAfter, nextDispatchDate, toISODate } from "./ship-date";

// 2026-08-01 = 토, 08-03 = 월, 08-05 = 수, 08-07 = 금.
describe("firstDeliveryOnOrAfter", () => {
  it("기준일이 주말이면 그 이후 첫 해당 요일", () => {
    // 8/1(토) 이후 첫 월요일 = 8/3
    expect(firstDeliveryOnOrAfter("mon", "2026-08-01")).toBe("2026-08-03");
  });

  it("기준일이 그 요일이면 기준일을 그대로(on/after 포함)", () => {
    expect(firstDeliveryOnOrAfter("mon", "2026-08-03")).toBe("2026-08-03");
  });

  it("기준일 이후 가장 가까운 해당 요일", () => {
    expect(firstDeliveryOnOrAfter("wed", "2026-08-03")).toBe("2026-08-05");
    expect(firstDeliveryOnOrAfter("fri", "2026-08-03")).toBe("2026-08-07");
  });

  it("같은 주 지난 요일이면 다음 주", () => {
    // 8/5(수) 기준 월요일 → 다음 주 월 8/10
    expect(firstDeliveryOnOrAfter("mon", "2026-08-05")).toBe("2026-08-10");
  });
});

// Date 는 로컬 자정으로 생성(월은 0-기반)해 TZ 흔들림을 피한다.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("nextDispatchDate — 금·토·일은 월요일 발송", () => {
  it("평일(월) 신청 → 익일(화)", () => {
    expect(toISODate(nextDispatchDate(d(2026, 8, 3)))).toBe("2026-08-04"); // 월→화
  });
  it("금 신청 → 다음 주 월", () => {
    // 8/7(금) → 8/10(월)
    expect(toISODate(nextDispatchDate(d(2026, 8, 7)))).toBe("2026-08-10");
  });
  it("토 신청 → 월", () => {
    expect(toISODate(nextDispatchDate(d(2026, 8, 1)))).toBe("2026-08-03"); // 토→월
  });
  it("일 신청 → 월", () => {
    expect(toISODate(nextDispatchDate(d(2026, 8, 2)))).toBe("2026-08-03"); // 일→월
  });
});

describe("nextDispatchDate — 공휴일 스킵", () => {
  it("발송 예정일이 공휴일(성탄절)이면 다음 영업일로 미룬다", () => {
    // 12/24(목) → 익일 12/25(금, 성탄절) → 주말 → 12/28(월)
    expect(toISODate(nextDispatchDate(d(2026, 12, 24)))).toBe("2026-12-28");
  });
  it("발송 예정일이 공휴일(한글날)이면 다음 영업일로 미룬다", () => {
    // 10/8(목) → 익일 10/9(금, 한글날) → 주말 → 10/12(월)
    expect(toISODate(nextDispatchDate(d(2026, 10, 8)))).toBe("2026-10-12");
  });
  it("연휴가 길게 끼면 연휴 다음 첫 영업일까지 전진(설 연휴)", () => {
    // 2/13(금) → 토 → 주말 → 2/16~2/18(설 연휴) → 2/19(목)
    expect(toISODate(nextDispatchDate(d(2026, 2, 13)))).toBe("2026-02-19");
  });
});
