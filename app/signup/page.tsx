"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";

export default function SignupPage() {
  const router = useRouter();
  const { configured } = useAuth();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    postcode: "",
    address: "",
    addressDetail: "",
  });
  const [agree, setAgree] = useState(false);
  const [marketingAgree, setMarketingAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!agree) {
      setError("이용약관과 개인정보처리방침에 동의해 주세요.");
      return;
    }
    const phone = form.phone.replace(/[^0-9]/g, "");
    if (phone.length < 10) {
      setError("배송·발송 안내를 받을 휴대폰 번호를 정확히 입력해 주세요.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabase();
      const { data, error: signErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      });
      if (signErr) throw signErr;

      const userId = data.user?.id;
      if (!userId) throw new Error("가입 처리에 실패했습니다. 다시 시도해 주세요.");

      if (data.session) {
        // 이메일 확인이 꺼져 있어 즉시 로그인됨 → 프로필 저장
        const { error: profErr } = await supabase.from("profiles").insert({
          id: userId,
          name: form.name.trim(),
          phone,
          postcode: form.postcode.trim() || null,
          address: form.address.trim() || null,
          address_detail: form.addressDetail.trim() || null,
          marketing_consent: marketingAgree,
          marketing_consent_at: marketingAgree ? new Date().toISOString() : null,
        });
        if (profErr) throw profErr;
        router.push("/account");
      } else {
        // 이메일 확인 필요 → 확인 후 최초 로그인 시 프로필 작성 안내
        setInfo(
          "가입 확인 메일을 보냈습니다. 메일의 링크로 인증한 뒤 로그인해 주세요."
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "가입 중 오류가 발생했습니다.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">Membership</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        귀한 분으로 모십니다.
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        송영신목장의 우유는 <span className="text-ink-soft">회원으로 모신 분께만</span>{" "}
        닿습니다. 정기구독은 선착순 500명 한정 — 한 분 한 분을 기억하고, 입금이
        확인되면 문자로 발송을 안내드립니다.
      </p>

      {!configured && (
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] text-gold-deep">
          현재 회원 시스템(Supabase) 연결이 설정되지 않았습니다. 관리자에게
          문의해 주세요.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field
          id="name"
          label="이름"
          autoComplete="name"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
        />
        <Field
          id="phone"
          label="휴대폰 번호"
          hint="입금 확인 후 발송 안내 문자를 받는 번호입니다."
          inputMode="numeric"
          autoComplete="tel"
          placeholder="01012345678"
          required
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
        />
        <Field
          id="email"
          label="이메일 (로그인 아이디)"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />
        <Field
          id="password"
          label="비밀번호"
          hint="6자 이상."
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
          value={form.password}
          onChange={(e) => update("password", e.target.value)}
        />

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Field
              id="postcode"
              label="우편번호"
              inputMode="numeric"
              value={form.postcode}
              onChange={(e) => update("postcode", e.target.value)}
            />
          </div>
          <div className="pb-1">
            <AddressSearch
              onSelect={(postcode, address) =>
                setForm((prev) => ({ ...prev, postcode, address }))
              }
            />
          </div>
        </div>
        <Field
          id="address"
          label="주소"
          autoComplete="street-address"
          value={form.address}
          onChange={(e) => update("address", e.target.value)}
        />
        <Field
          id="addressDetail"
          label="상세 주소"
          value={form.addressDetail}
          onChange={(e) => update("addressDetail", e.target.value)}
        />

        <label className="flex items-start gap-2.5 pt-1 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-deep"
          />
          <span>
            <Link href="/terms" className="underline hover:text-gold">
              이용약관
            </Link>
            {" 및 "}
            <Link href="/privacy" className="underline hover:text-gold">
              개인정보처리방침
            </Link>
            에 동의합니다.
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-soft">
          <input
            type="checkbox"
            checked={marketingAgree}
            onChange={(e) => setMarketingAgree(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gold-deep"
          />
          <span>
            <span className="text-mute">[선택]</span> 할인·이벤트 등{" "}
            <span className="text-ink">광고성 정보 문자 수신</span>에 동의합니다.
            <span className="mt-0.5 block text-[12px] text-mute">
              동의하지 않아도 가입할 수 있으며, 주문·입금·배송 안내 문자는 동의와 무관하게 발송됩니다.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] text-gold-deep">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !configured}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "처리 중…" : "가입하기"}
        </button>
      </form>

      <p className="mt-6 text-center text-[14px] text-mute">
        이미 회원이신가요?{" "}
        <Link href="/login" className="text-gold-deep underline hover:text-gold">
          로그인
        </Link>
      </p>
    </div>
  );
}
