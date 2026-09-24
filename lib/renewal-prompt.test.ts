import { describe, it, expect } from "vitest";
import {
  shouldPromptRenewal,
  RENEWAL_PROMPT_REMAINING,
  RENEWAL_PROMPT_MIN_DELIVERED,
  isPendingRenewalError,
  PENDING_RENEWAL_NOTICE,
  PENDING_RENEWAL_WHERE,
} from "./renewal-prompt";

const base = { started: true, paused: false, delivered: 5, remaining: 3 };

describe("shouldPromptRenewal", () => {
  it("남은 3회 + 5회 받음 → 안내한다(8주 구독의 3주 전)", () => {
    expect(shouldPromptRenewal(base)).toBe(true);
  });

  it("남은 4회면 아직 이르다", () => {
    expect(shouldPromptRenewal({ ...base, delivered: 4, remaining: 4 })).toBe(false);
  });

  it("회차를 다 쓴 구독도 안내 대상 — 그때가 가장 필요한 시점이다", () => {
    expect(shouldPromptRenewal({ ...base, delivered: 8, remaining: 0 })).toBe(true);
  });

  it("이제 막 시작한 구독엔 띄우지 않는다(4주 구독, 1회 받고 남은 3회)", () => {
    expect(shouldPromptRenewal({ started: true, paused: false, delivered: 1, remaining: 3 })).toBe(
      false
    );
  });

  it("4주 구독도 2회 받으면 안내한다(남은 2회)", () => {
    expect(shouldPromptRenewal({ started: true, paused: false, delivered: 2, remaining: 2 })).toBe(
      true
    );
  });

  it("정지 중에는 띄우지 않는다 — 쉬는 분께 재촉이 된다", () => {
    expect(shouldPromptRenewal({ ...base, paused: true })).toBe(false);
  });

  it("아직 시작 전(입금대기) 구독엔 띄우지 않는다", () => {
    expect(shouldPromptRenewal({ ...base, started: false })).toBe(false);
  });

  it("옛 기준(남은 2회)보다 한 주 일찍 뜬다", () => {
    // 8주 구독: 옛 규칙은 delivered 6 부터, 새 규칙은 delivered 5 부터.
    expect(shouldPromptRenewal({ started: true, paused: false, delivered: 5, remaining: 3 })).toBe(
      true
    );
    expect(RENEWAL_PROMPT_REMAINING).toBe(3);
    expect(RENEWAL_PROMPT_MIN_DELIVERED).toBe(2);
  });
});

describe("isPendingRenewalError", () => {
  it("서버의 중복 연장 거절을 알아본다", () => {
    // request_renewal 의 실제 문구(운영 DB 정의에서 그대로).
    expect(
      isPendingRenewalError("이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.")
    ).toBe(true);
  });

  it("다른 거절은 원문을 그대로 보여 주도록 false", () => {
    expect(isPendingRenewalError("연장할 수 있는 활성 구독이 아닙니다.")).toBe(false);
    expect(isPendingRenewalError("품절된 상품입니다: milk-750")).toBe(false);
    expect(isPendingRenewalError("회당 최소 상품 금액은 정가 기준 24,000원입니다.")).toBe(false);
  });

  it("안내 문구는 갈 곳을 가리킨다 — 세 화면이 같은 곳을 말해야 한다", () => {
    expect(PENDING_RENEWAL_WHERE).toContain("마이페이지");
    expect(PENDING_RENEWAL_WHERE).toContain("연장 입금 안내");
    // 체크아웃·마이페이지가 쓰는 긴 안내도 같은 문장을 품는다(갈라질 수 없게).
    expect(PENDING_RENEWAL_NOTICE).toContain(PENDING_RENEWAL_WHERE);
  });
});
