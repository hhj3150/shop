"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/Field";
import { KakaoLoginButton } from "@/components/KakaoLoginButton";

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
  // 구독 결제로 오던 길이면(=고관여 진입), 막다른 벽 대신 혜택 + 무로그인 단품 대안을 보여준다.
  const fromCheckout = next.includes("checkout");
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
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] text-gold-deep">
          현재 회원 시스템 연결이 설정되지 않았습니다.
        </p>
      )}

      {/* 카카오 — 한 번에 시작(가입+로그인). 한국 사용자 주력 동선. */}
      {configured && (
        <div className="mt-6">
          <KakaoLoginButton next={next} />
        </div>
      )}

      {fromCheckout && (
        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-5">
          <p className="text-[14px] leading-relaxed text-ink-soft">
            정기구독은 <span className="font-medium text-ink">구독 관리·적립금·재구매 자동</span>을 위해
            회원으로 시작합니다. 가입은 30초면 됩니다.
          </p>
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="mt-3 inline-flex rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.98]"
          >
            30초 가입하고 구독 시작
          </Link>
          <p className="mt-3 text-[13px] text-mute">
            처음이세요?{" "}
            <Link href="/order-once" className="text-gold-deep underline underline-offset-2 hover:text-gold">
              로그인 없이 단품으로 먼저 맛보기 →
            </Link>
          </p>
        </div>
      )}

      {configured && (
        <div className="mt-7 flex items-center gap-3 text-[12px] text-mute">
          <span className="h-px flex-1 bg-line" />
          또는 이메일로
          <span className="h-px flex-1 bg-line" />
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
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
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
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

      <p className="mt-5 text-center text-[14px]">
        <Link
          href="/forgot-password"
          className="text-mute underline hover:text-gold-deep"
        >
          비밀번호를 잊으셨나요?
        </Link>
      </p>

      <p className="mt-3 text-center text-[14px] text-mute">
        아직 회원이 아니신가요?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="text-gold-deep underline hover:text-gold"
        >
          회원가입
        </Link>
      </p>
    </div>
  );
}
