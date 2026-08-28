import { describe, it, expect } from "vitest";
import { shouldNotifyDelivered, DELIVERED_NOTICE_MAX_DAYS } from "@/lib/delivered-notice";

describe("shouldNotifyDelivered", () => {
  const today = "2026-08-28";

  it("최근 발송분(기준일 이내)은 배송 완료 안내를 보낸다", () => {
    expect(shouldNotifyDelivered("2026-08-28", today)).toBe(true);
    expect(shouldNotifyDelivered("2026-08-26", today)).toBe(true);
    expect(shouldNotifyDelivered("2026-08-21", today)).toBe(true); // D+7 경계
  });

  it("오래된 발송분(지난 기록 정리)은 문자를 보내지 않는다", () => {
    expect(shouldNotifyDelivered("2026-08-20", today)).toBe(false); // D+8
    // 실사고 재현: 6~8주 전 발송 건을 일괄 배송완료로 바꿔 문자가 무더기로 나갔다.
    expect(shouldNotifyDelivered("2026-07-27", today)).toBe(false);
    expect(shouldNotifyDelivered("2026-06-04", today)).toBe(false);
  });

  it("발송일을 모르거나 미래면 기존대로 보낸다(정상 1건 누락 방지)", () => {
    expect(shouldNotifyDelivered(null, today)).toBe(true);
    expect(shouldNotifyDelivered(undefined, today)).toBe(true);
    expect(shouldNotifyDelivered("2026-08-31", today)).toBe(true);
  });

  it("타임스탬프 문자열도 날짜만 보고 판정한다", () => {
    expect(shouldNotifyDelivered("2026-08-26T05:00:00+00:00", today)).toBe(true);
    expect(shouldNotifyDelivered("2026-06-29T07:00:00+00:00", today)).toBe(false);
  });

  it("기준일수는 조정 가능하다", () => {
    expect(shouldNotifyDelivered("2026-08-20", today, 30)).toBe(true);
    expect(DELIVERED_NOTICE_MAX_DAYS).toBe(7);
  });
});
