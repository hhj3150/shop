"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

// 카카오 OAuth 시작 버튼. Supabase Kakao provider로 로그인/가입을 한 번에 처리한다.
//   - redirectTo: 로그인 후 돌아올 내부 경로(구독 결제 등에서 next로 전달).
//   - 세션은 클라이언트(detectSessionInUrl)가 복귀 시 자동 수립 → 별도 콜백 라우트 불필요.
//   - 카카오 사용자는 이름·연락처가 비어 있을 수 있고(트리거가 빈 값으로 생성),
//     결제 화면에서 채우면 된다(기존 동선).
export function KakaoLoginButton({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      // next 우선순위: prop → 현재 URL의 next → /account. 내부 경로만 허용(open-redirect 차단).
      const wanted =
        next ?? new URLSearchParams(window.location.search).get("next") ?? "/account";
      const dest = wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/account";
      const redirectTo = `${window.location.origin}${dest}`;
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider: "kakao",
        // 카카오 동의항목에서 켜둔 항목만 요청한다(닉네임=필수, 이메일=선택 동의).
        //   카카오에서 사용 안 함인 항목을 요청하면 KOE205로 거부되므로 명시한다.
        //   이메일은 선택 동의라 사용자가 거절할 수 있다 → Supabase의
        //   "Allow users without an email"을 ON으로 둬야 거절자도 가입된다.
        options: { redirectTo, scopes: "account_email profile_nickname" },
      });
      if (error) throw error;
      // 정상 시 카카오로 페이지가 이동하므로 이후 코드는 실행되지 않는다.
    } catch (err) {
      console.error("카카오 로그인 시작 실패:", err);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      aria-label="카카오로 시작"
      className="flex w-full items-center justify-center gap-2 rounded-full bg-[#FEE500] py-4 text-sm font-medium tracking-wide text-[#181600] transition-[transform,filter] hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3C6.99 3 3 6.2 3 10.13c0 2.5 1.66 4.7 4.16 5.96-.18.64-.66 2.36-.76 2.73-.12.46.17.45.36.33.15-.1 2.36-1.6 3.32-2.26.63.09 1.27.14 1.92.14 5.01 0 9-3.2 9-7.13S17.01 3 12 3Z" />
      </svg>
      {busy ? "카카오로 이동 중…" : "카카오로 시작"}
    </button>
  );
}
