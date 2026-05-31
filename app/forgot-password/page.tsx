"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/Field";

export default function ForgotPasswordPage() {
  const { configured } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const addr = email.trim();
    if (!addr) {
      setError("가입하신 이메일을 입력해 주세요.");
      return;
    }

    setBusy(true);
    try {
      // 재설정 링크가 도착할 페이지. Supabase 콘솔의 Redirect URLs 에
      // 이 주소(.../reset-password)가 허용 등록되어 있어야 한다.
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetErr } = await getSupabase().auth.resetPasswordForEmail(
        addr,
        { redirectTo }
      );
      if (resetErr) throw resetErr;
      // 가입 여부와 무관하게 동일 안내(가입 여부 노출 방지).
      setSent(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "메일 발송 중 오류가 발생했습니다.";
      setError(
        /rate limit/i.test(message)
          ? "잠시 후 다시 시도해 주세요. (요청이 너무 잦습니다)"
          : message
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">Members</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        비밀번호 찾기
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        가입하신 이메일로 비밀번호 재설정 링크를 보내드립니다. 메일의 링크로
        새 비밀번호를 설정해 주세요.
      </p>

      {!configured && (
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] text-gold-deep">
          현재 회원 시스템 연결이 설정되지 않았습니다.
        </p>
      )}

      {sent ? (
        <div className="mt-8 space-y-5">
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
            입력하신 이메일이 가입되어 있다면, 비밀번호 재설정 링크를
            보내드렸습니다. 메일함(스팸함 포함)을 확인해 주세요.
          </p>
          <Link
            href="/login"
            className="block w-full rounded-full bg-ink py-4 text-center text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
          >
            로그인으로 돌아가기
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <Field
            id="email"
            label="이메일"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {error && (
            <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "보내는 중…" : "재설정 메일 보내기"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-[14px] text-mute">
        비밀번호가 기억나셨나요?{" "}
        <Link href="/login" className="text-gold-deep underline hover:text-gold">
          로그인
        </Link>
      </p>
    </div>
  );
}
