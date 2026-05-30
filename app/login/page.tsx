"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/Field";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/account";
  const { configured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: signErr } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) throw signErr;
      router.push(next);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "로그인에 실패했습니다.";
      setError(
        /invalid login/i.test(message)
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
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
        로그인
      </h1>

      {!configured && (
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[13px] text-gold-deep">
          현재 회원 시스템 연결이 설정되지 않았습니다.
        </p>
      )}

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
        <Field
          id="password"
          label="비밀번호"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !configured}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-mute">
        아직 회원이 아니신가요?{" "}
        <Link href="/signup" className="text-gold-deep underline hover:text-gold">
          회원가입
        </Link>
      </p>
    </div>
  );
}
