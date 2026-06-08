"use client";

// 가입 직후 1회성 후속 작업(추천 등록 + 환영 문자).
//
// 이메일 확인 ON 이면 가입 시점에 session 이 없어(인증 후 첫 로그인에서 생김) 이 작업들을
// 가입 핸들러에서 바로 실행할 수 없다. 그래서 가입 시 localStorage 에 플래그만 남기고,
// 실제 실행은 AuthProvider 의 최초 SIGNED_IN 시점으로 미룬다(lib/auth.tsx).
// → 이메일 확인 ON/OFF 와 무관하게 추천코드·환영문자가 유실되지 않는다.
//
// 멱등: 추천코드/환영 플래그는 실행 직후 제거하므로 일반 로그인에서는 no-op 이다.
// best-effort — 어떤 실패도 로그인 흐름을 막지 않는다.

import { getSupabase } from "./supabase";
import { notify } from "./notify";
import { REFERRAL_STORAGE_KEY } from "@/components/ReferralCapture";

// 환영 문자 발송 대기 플래그. 가입 핸들러가 signUp 직전에 세팅한다.
export const WELCOME_PENDING_KEY = "ssm_welcome_pending";

// 인증된 세션이 막 생긴 시점(최초 로그인)에 호출한다. 호출 시 세션이 있어야 한다.
export async function runPostSignupTasks(): Promise<void> {
  // 1) 추천 등록: 추천 링크로 유입돼 저장된 코드가 있으면 claim. RPC 가 자가추천·중복을 자체 차단한다.
  try {
    const ref = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (ref) {
      window.localStorage.removeItem(REFERRAL_STORAGE_KEY); // 먼저 제거해 재시도 중복 방지
      await getSupabase().rpc("claim_referral", { p_code: ref });
    }
  } catch {
    // 추천 등록 실패는 무시(로그인 보호)
  }

  // 2) 환영 문자: 가입 시 세팅된 플래그가 있을 때만 1회 발송.
  try {
    if (window.localStorage.getItem(WELCOME_PENDING_KEY) === "1") {
      window.localStorage.removeItem(WELCOME_PENDING_KEY); // 먼저 제거해 중복 발송 방지
      void notify({ kind: "welcome" });
    }
  } catch {
    // 환영 문자 실패는 무시(로그인 보호)
  }
}
