import { describe, it, expect } from "vitest";
import { isNoticeFresh, NOTICE_MAX_DAYS } from "@/lib/notice-freshness";

describe("isNoticeFresh", () => {
  const today = "2026-08-28";

  it("최근 출고분은 안내를 보낸다", () => {
    expect(isNoticeFresh("2026-08-28", today)).toBe(true);
    expect(isNoticeFresh("2026-08-26", today)).toBe(true);
    expect(isNoticeFresh("2026-08-21", today)).toBe(true); // D+7 경계
  });

  it("오래된 출고분(지난 기록 정리)은 문자를 보내지 않는다", () => {
    expect(isNoticeFresh("2026-08-20", today)).toBe(false); // D+8
    // 실사고 재현: 6~8주 전 출고 건을 일괄 배송완료로 바꿔 문자가 무더기로 나갔다.
    expect(isNoticeFresh("2026-07-27", today)).toBe(false);
    expect(isNoticeFresh("2026-06-04", today)).toBe(false);
  });

  it("timestamptz 는 KST 달력일로 환산해 판정한다", () => {
    // 2026-08-21T15:30:00Z = KST 8/22 00:30 → D+6
    expect(isNoticeFresh("2026-08-21T15:30:00+00:00", today)).toBe(true);
    // 2026-08-20T14:00:00Z = KST 8/20 23:00 → D+8
    expect(isNoticeFresh("2026-08-20T14:00:00+00:00", today)).toBe(false);
  });

  it("이월 발송 회귀: 예정일이 지났어도 '실제 출고'가 최근이면 보낸다", () => {
    // 8/20 예정분을 8/28에 뒤늦게 보낸 건 — 예정일로 재면 D+8 이라 정상 안내가 막힌다.
    expect(isNoticeFresh("2026-08-20", today)).toBe(false); // 예정일 기준(옛 판정)
    expect(isNoticeFresh("2026-08-28T06:30:00+00:00", today)).toBe(true); // 실제 출고 기준
  });

  it("출고 시점을 모르거나 미래면 기존대로 보낸다(정상 1건 누락 방지)", () => {
    expect(isNoticeFresh(null, today)).toBe(true);
    expect(isNoticeFresh(undefined, today)).toBe(true);
    expect(isNoticeFresh("2026-08-31", today)).toBe(true);
  });

  it("기준일수는 조정 가능하다", () => {
    expect(isNoticeFresh("2026-08-20", today, 30)).toBe(true);
    expect(NOTICE_MAX_DAYS).toBe(7);
  });
});
