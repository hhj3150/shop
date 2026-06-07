import { describe, it, expect } from "vitest";
import { kstYearMonth, kstYmd } from "./kst";

// created_at 은 Supabase timestamptz(UTC ISO). KST(UTC+9)로 환산해 월/일을 버킷팅해야 한다.
//   KST 자정 = UTC 전날 15:00. 즉 UTC 15:00 이상이면 KST 로는 다음 날.
describe("kstYearMonth", () => {
  it("UTC 월말 저녁(15:00Z)은 KST 로 다음 달", () => {
    // UTC 2026-06-30 15:00 → KST 2026-07-01 → 7월
    expect(kstYearMonth("2026-06-30T15:00:00+00:00")).toBe("2026-07");
  });

  it("UTC 월말 14:59:59Z 은 아직 같은 달(KST 23:59)", () => {
    expect(kstYearMonth("2026-06-30T14:59:59+00:00")).toBe("2026-06");
  });

  it("연말 경계도 연도까지 넘긴다", () => {
    expect(kstYearMonth("2026-12-31T15:30:00+00:00")).toBe("2027-01");
  });

  it("Z 표기·밀리초도 처리", () => {
    expect(kstYearMonth("2026-06-30T13:00:00.123Z")).toBe("2026-06");
  });

  it("빈 문자열·잘못된 값은 빈 문자열(버킷 제외)", () => {
    expect(kstYearMonth("")).toBe("");
    expect(kstYearMonth("not-a-date")).toBe("");
  });
});

describe("kstYmd", () => {
  it("UTC 저녁(15:00Z)은 KST 로 다음 날짜", () => {
    expect(kstYmd("2026-06-30T15:00:00+00:00")).toBe("2026-07-01");
  });

  it("UTC 22:00(=KST 익일 07:00)도 다음 날", () => {
    expect(kstYmd("2026-06-30T22:00:00+00:00")).toBe("2026-07-01");
  });

  it("UTC 낮(13:00Z=KST 22:00)은 같은 날", () => {
    expect(kstYmd("2026-06-30T13:00:00+00:00")).toBe("2026-06-30");
  });

  it("빈 문자열·잘못된 값은 빈 문자열", () => {
    expect(kstYmd("")).toBe("");
    expect(kstYmd("garbage")).toBe("");
  });
});
