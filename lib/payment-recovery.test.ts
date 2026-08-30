import { describe, it, expect } from "vitest";
import {
  decideAction,
  buildUnpaidDigest,
  elapsedHours,
  type UnpaidItem,
  type RecoveryTarget,
} from "./payment-recovery";

const base: RecoveryTarget = {
  orderId: "o1",
  createdAt: "2026-06-01T01:00:00.000Z", // 2026-06-01 10:00 KST
  shipName: "홍길동",
  shipPhone: "01012345678",
  orderNo: "20260601-0001",
  totalAmount: 39000,
  hasSubscription: true,
  sentStages: [],
};

describe("decideAction (주문 후 경과 시간)", () => {
  it("D+0 당일은 none", () => {
    const now = new Date("2026-06-01T05:00:00.000Z"); // 같은 날 14:00 KST
    expect(decideAction(base, now)).toBe("none");
  });
  it("D+1은 D1", () => {
    const now = new Date("2026-06-02T00:30:00.000Z"); // 06-02 09:30 KST
    expect(decideAction(base, now)).toBe("D1");
  });
  it("D+1인데 이미 D1 보냈으면 none", () => {
    const now = new Date("2026-06-02T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D1"] }, now)).toBe("none");
  });
  it("D+2는 D2", () => {
    const now = new Date("2026-06-03T00:30:00.000Z"); // 06-03 09:30 KST
    expect(decideAction(base, now)).toBe("D2");
  });
  it("D+2인데 이미 D2 보냈으면 none", () => {
    const now = new Date("2026-06-03T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D2"] }, now)).toBe("none");
  });
  // ★ 자동취소 폐지(2026-07-05 실사고): D+3 은 고객 취소·문자가 아니라 관리자 알림.
  it("D+3 이상은 EXPIRE_NOTIFY(관리자 알림) — 고객 취소·취소문자 없음", () => {
    const now = new Date("2026-06-04T00:30:00.000Z"); // 06-04 09:30 KST
    expect(decideAction(base, now)).toBe("EXPIRE_NOTIFY");
  });
  it("D+3 이상인데 이미 관리자에게 알렸으면 none(매일 반복 알림 방지)", () => {
    const now = new Date("2026-06-05T00:30:00.000Z"); // D+4
    expect(decideAction({ ...base, sentStages: ["D1", "D2", "EXPIRE_NOTIFY"] }, now)).toBe("none");
  });
  it("KST 자정 직후 경계: UTC로는 전날이어도 경과 14시간이라 D1", () => {
    // created 06-01 10:00 KST. now = 06-02 00:10 KST (= 06-01T15:10Z)
    const now = new Date("2026-06-01T15:10:00.000Z");
    expect(decideAction(base, now)).toBe("D1");
  });

  // ★ 12시간 최소 대기(2026-08-28): 달력일 기준일 땐 밤늦은 주문이 9시간 만에 독촉을
  //   받았다(실사례 SY20260716-8167: 21:04 주문 → 다음날 09:08 D1).
  it("밤 11시 50분 주문은 다음날 아침 크론(9시간 경과)에 독촉하지 않는다", () => {
    const late = { ...base, createdAt: "2026-06-01T14:50:00.000Z" }; // 06-01 23:50 KST
    const cron = new Date("2026-06-02T00:00:00.000Z"); // 06-02 09:00 KST — 9.2시간 경과
    expect(decideAction(late, cron)).toBe("none");
  });
  it("그 주문은 그 다음날 크론(33시간 경과)에 D2 가 아니라 D1 부터 나간다", () => {
    const late = { ...base, createdAt: "2026-06-01T14:50:00.000Z" };
    const cron = new Date("2026-06-03T00:00:00.000Z"); // 33.2시간 경과
    expect(decideAction(late, cron)).toBe("D1");
    expect(decideAction({ ...late, sentStages: ["D1"] }, new Date("2026-06-04T00:00:00.000Z")))
      .toBe("D2"); // 57.2시간 → 다음 단계
  });
  it("정확히 12시간 지나면 D1", () => {
    const now = new Date("2026-06-01T13:00:00.000Z"); // created 06-01T01:00Z + 12h
    expect(decideAction(base, now)).toBe("D1");
  });
  it("11시간 59분이면 아직 보내지 않는다", () => {
    const now = new Date("2026-06-01T12:59:00.000Z");
    expect(decideAction(base, now)).toBe("none");
  });
});

describe("buildUnpaidDigest (관리자 확인 요약)", () => {
  const t = (over: Partial<RecoveryTarget> = {}): RecoveryTarget => ({
    ...base,
    ...over,
  });
  const item = (over: Partial<RecoveryTarget>, hours: number): UnpaidItem => ({
    target: t(over),
    hoursElapsed: hours,
  });

  it("알릴 게 없으면 문자도 없다(null)", () => {
    expect(buildUnpaidDigest([], 0)).toBeNull();
  });

  it("건수·주문번호·이름·금액·경과시간을 한 통에 담는다", () => {
    const d = buildUnpaidDigest(
      [
        item({ orderNo: "SY20260829-9912", shipName: "김손님", totalAmount: 24500 }, 13),
        item({ orderNo: "SY20260828-1695", shipName: "이손님", totalAmount: 30300 }, 37),
      ],
      2
    );
    expect(d).not.toBeNull();
    expect(d!.text).toContain("미입금 확인 필요 2건");
    expect(d!.text).toContain("SY20260829-9912 김손님 24,500원 · 13시간 경과");
    expect(d!.text).toContain("SY20260828-1695 이손님 30,300원 · 37시간 경과");
  });

  it("손님에게 독촉이 나가지 않는다는 사실을 본문에 못박는다", () => {
    const d = buildUnpaidDigest([item({}, 13)], 1);
    expect(d!.text).toContain("손님에게는 독촉 문자가 나가지 않습니다");
  });

  it("48시간이 넘으면 일 단위로 적는다", () => {
    const d = buildUnpaidDigest([item({}, 61)], 1);
    expect(d!.text).toContain("2일 경과");
  });

  it("정기구독은 (정기) 로 구분한다", () => {
    const d = buildUnpaidDigest([item({ hasSubscription: true }, 13)], 1);
    expect(d!.text).toContain("(정기)");
  });

  it("15건을 넘으면 '외 N건'으로 접는다", () => {
    const many = Array.from({ length: 18 }, (_, i) =>
      item({ orderNo: `SY-${i}` }, 13)
    );
    const d = buildUnpaidDigest(many, 18);
    expect(d!.text).toContain("· 외 3건");
  });

  it("이번에 걸린 건 외에 대기 중인 주문이 더 있으면 전체 건수도 알린다", () => {
    const d = buildUnpaidDigest([item({}, 13)], 5);
    expect(d!.text).toContain("현재 입금대기 전체 5건");
  });
});

describe("elapsedHours", () => {
  it("주문 시각으로부터 경과 시간을 잰다", () => {
    const now = new Date("2026-08-30T02:00:00.000Z");
    expect(elapsedHours("2026-08-29T14:00:00.000Z", now)).toBe(12);
  });
});
