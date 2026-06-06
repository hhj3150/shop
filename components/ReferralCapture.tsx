"use client";

// 추천 링크(/?ref=CODE)로 들어온 방문자의 코드를 localStorage 에 저장한다.
//   가입 완료 시 signup 페이지가 이 값을 읽어 claim_referral 을 호출한다.
import { useEffect } from "react";
import { extractRefCode } from "@/lib/referral";

export const REFERRAL_STORAGE_KEY = "hey_ref";

export function ReferralCapture() {
  useEffect(() => {
    try {
      const code = extractRefCode(window.location.search);
      if (code) window.localStorage.setItem(REFERRAL_STORAGE_KEY, code);
    } catch {
      // localStorage 접근 불가(프라이빗 모드 등)는 무시
    }
  }, []);
  return null;
}
