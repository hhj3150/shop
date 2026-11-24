import { describe, expect, it } from "vitest";
import { startChangeLock, type StartLockInput } from "./slot-start-lock";

const base: StartLockInput = {
  isRenewalRow: false,
  shippedCount: 0,
  confirmedCount: null,
  deliveryMethod: "택배",
  startedAt: "2026-12-07",
  todayISO: "2026-11-24",
};

describe("startChangeLock — 구독 시작일 변경을 열어도 되는가", () => {
  it("아직 한 번도 안 나간 택배 구독은 바꿀 수 있다(입금 후 늦게 시작)", () => {
    expect(startChangeLock(base)).toBeNull();
  });

  // 윤화영 거래처 재현: 연장 주문 행에서 연장분 시작일을 정하려다 슬롯 앵커가 밀렸다.
  it("연장 주문 행에서는 열지 않는다 — 연장분은 앞 기간이 끝난 다음 회차부터", () => {
    const why = startChangeLock({ ...base, isRenewalRow: true });
    expect(why).toMatch(/연장분은 시작일을 따로 정하지 않습니다/);
  });

  it("한 번이라도 나간 구독은 막는다", () => {
    expect(startChangeLock({ ...base, shippedCount: 12 })).toMatch(/이미 12회 나간 구독/);
  });

  it("출고 기록이 없어도 회차를 확정했으면 막는다(기록 누락 보정분)", () => {
    expect(startChangeLock({ ...base, confirmedCount: 8 })).toMatch(/이미 8회/);
  });

  it("확정 회차가 기록보다 크면 큰 쪽을 보여 준다", () => {
    expect(startChangeLock({ ...base, shippedCount: 17, confirmedCount: 18 })).toMatch(/이미 18회/);
  });

  it("방문수령은 기록이 안 남으므로 시작일이 지났으면 막는다", () => {
    expect(
      startChangeLock({ ...base, deliveryMethod: "방문수령", startedAt: "2026-06-18" })
    ).toMatch(/방문수령/);
  });

  it("방문수령이라도 아직 시작 전이면 바꿀 수 있다", () => {
    expect(startChangeLock({ ...base, deliveryMethod: "방문수령", startedAt: "2026-12-03" })).toBeNull();
  });

  it("시작일이 오늘인 방문수령은 이미 시작한 것으로 본다", () => {
    expect(
      startChangeLock({ ...base, deliveryMethod: "방문수령", startedAt: "2026-11-24" })
    ).not.toBeNull();
  });
});
