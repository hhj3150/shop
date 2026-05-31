"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/Field";

export default function ResetPasswordPage() {
  const router = useRouter();
  // 메일 링크로 들어오면 Supabase 클라이언트가 URL의 복구 세션을 자동 인식한다.
  // ready=세션 확인 완료, session=복구(또는 기존) 세션 존재 여부.
  const { configured, ready, session } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("비밀번호는 6자 이상으로 입력해 주세요.");
      return;
    }
    if (password !== confirm) {
      setError("두 비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    try {
      const { error: updErr } = await getSupabase().auth.updateUser({ password });
      if (updErr) throw updErr;
      setDone(true);
      setTimeout(() => router.push("/account"), 1600);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "비밀번호 변경에 실패했습니다.";
      setError(
        /session|missing|expired|invalid|token/i.test(message)
          ? "재설정 링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요."
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
        새 비밀번호 설정
      </h1>

      {!configured ? (
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] text-gold-deep">
          현재 회원 시스템 연결이 설정되지 않았습니다.
        </p>
      ) : !ready ? (
        <p className="mt-8 text-[14px] text-mute">확인 중…</p>
      ) : done ? (
        <p className="mt-8 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
          비밀번호가 변경되었습니다. 잠시 후 마이페이지로 이동합니다.
        </p>
      ) : !session ? (
        <div className="mt-8 space-y-5">
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] leading-relaxed text-red-700">
            재설정 링크가 만료되었거나 올바르지 않습니다. 비밀번호 찾기를 다시
            진행해 주세요.
          </p>
          <Link
            href="/forgot-password"
            className="block w-full rounded-full bg-ink py-4 text-center text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
          >
            비밀번호 찾기 다시 하기
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <Field
            id="password"
            label="새 비밀번호"
            hint="6자 이상."
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="confirm"
            label="새 비밀번호 확인"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {error && (
            <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "변경 중…" : "비밀번호 변경"}
          </button>
        </form>
      )}
    </div>
  );
}
