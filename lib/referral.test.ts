import { describe, expect, it } from "vitest";
import {
  REFERRAL_REWARD_KRW,
  normalizeReferralCode,
  isValidReferralCode,
  referralLink,
  extractRefCode,
} from "./referral";

describe("referral 유틸", () => {
  it("보상 금액은 5,000원(추천인·피추천인 각각)이다", () => {
    expect(REFERRAL_REWARD_KRW).toBe(5000);
  });

  describe("normalizeReferralCode", () => {
    it("대문자화·구두점·공백 제거 후 8자리 코드를 반환한다", () => {
      expect(normalizeReferralCode("abcd-2345")).toBe("ABCD2345");
      expect(normalizeReferralCode(" abcd 2345 ")).toBe("ABCD2345");
      expect(normalizeReferralCode(" hjk 23q ")).toBeNull(); // 7자리 → 무효
    });

    it("형식(8자리·허용문자)에 맞지 않으면 null", () => {
      expect(normalizeReferralCode("ABC123")).toBeNull(); // 7자리 미만
      expect(normalizeReferralCode("ABCD23456")).toBeNull(); // 9자리
      expect(normalizeReferralCode("ABCD0O1I")).toBeNull(); // 혼동문자 0,O,1,I 불가
      expect(normalizeReferralCode("")).toBeNull();
      expect(normalizeReferralCode(null)).toBeNull();
      expect(normalizeReferralCode(undefined)).toBeNull();
    });

    it("허용문자(0/O/1/I/L 제외)로만 구성된 8자리는 통과한다", () => {
      expect(normalizeReferralCode("ABCDQ23K")).toBe("ABCDQ23K");
      expect(normalizeReferralCode("hjmn2345")).toBe("HJMN2345");
    });
  });

  describe("isValidReferralCode", () => {
    it("유효/무효를 boolean으로 판별한다", () => {
      expect(isValidReferralCode("ABCDQ23K")).toBe(true);
      expect(isValidReferralCode("nope")).toBe(false);
    });
  });

  describe("referralLink", () => {
    it("origin 끝 슬래시를 정리하고 ?ref= 링크를 만든다", () => {
      expect(referralLink("ABCDQ23K", "https://shop.a2jerseymilk.com")).toBe(
        "https://shop.a2jerseymilk.com/?ref=ABCDQ23K"
      );
      expect(referralLink("abcdq23k", "https://shop.a2jerseymilk.com/")).toBe(
        "https://shop.a2jerseymilk.com/?ref=ABCDQ23K"
      );
    });
    it("코드가 유효하지 않으면 null", () => {
      expect(referralLink("bad", "https://x.com")).toBeNull();
    });
  });

  describe("extractRefCode", () => {
    it("쿼리스트링에서 ref 코드를 정규화해 추출한다", () => {
      expect(extractRefCode("?ref=ABCDQ23K")).toBe("ABCDQ23K");
      expect(extractRefCode("https://shop.a2jerseymilk.com/?foo=1&ref=abcdq23k")).toBe("ABCDQ23K");
    });
    it("ref가 없거나 형식이 틀리면 null", () => {
      expect(extractRefCode("?foo=1")).toBeNull();
      expect(extractRefCode("?ref=bad")).toBeNull();
      expect(extractRefCode("")).toBeNull();
      expect(extractRefCode(null)).toBeNull();
    });
  });
});
