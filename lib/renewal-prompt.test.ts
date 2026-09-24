import { describe, it, expect } from "vitest";
import {
  shouldPromptRenewal,
  RENEWAL_PROMPT_REMAINING,
  RENEWAL_PROMPT_MIN_DELIVERED,
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
