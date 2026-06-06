"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  addBillingCard,
  registerBillingKey,
  isBillingConfigured,
} from "@/lib/billing";

// 정기결제용 카드(빌링키) 관리 페이지.
//   - 등록된 카드 목록 표시 (billing_keys.status='활성')
//   - "카드 등록" → 발급창 → 서버 검증·저장 (PC/팝업)
//   - 모바일 리디렉션 복귀 시: 쿼리의 billingKey 로 자동 등록 처리
//
// isBillingConfigured(빌링 채널 미설정) 시에는 준비중 안내만 노출(라이브 무중단).

type BillingCardRow = {
  id: string;
  card_name: string | null;
  card_last4: string | null;
  pg_provider: string | null;
  issued_at: string;
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function AccountBillingPage() {
  return (
    <Suspense>
      <BillingManager />
    </Suspense>
  );
}

function BillingManager() {
  const router = useRouter();
  const sp = useSearchParams();
  const { ready, user } = useAuth();

  const [cards, setCards] = useState<BillingCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 로그인 가드.
  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/account/billing");
  }, [ready, user, router]);

  // 등록된 카드 목록 조회 (본인 RLS).
  const loadCards = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error: qErr } = await getSupabase()
        .from("billing_keys")
        .select("id, card_name, card_last4, pg_provider, issued_at")
        // 본인 것만 — 관리자 계정은 RLS상 전체 조회가 가능하므로 user_id 를 반드시 명시한다.
        .eq("user_id", user.id)
        .eq("status", "활성")
        .order("issued_at", { ascending: false });
      if (qErr) throw qErr;
      setCards((data as BillingCardRow[]) ?? []);
    } catch (err) {
      console.error("빌링키 목록 조회 실패:", err);
      setError("카드 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadCards();
  }, [user, loadCards]);

  // 모바일 리디렉션 복귀 처리: 쿼리에 billingKey(성공) 또는 code(실패)가 실려 온다.
  useEffect(() => {
    if (!user) return;
    const failCode = sp.get("code");
    const billingKey = sp.get("billingKey");
    if (!failCode && !billingKey) return;

    // 쿼리를 비워 새로고침·재처리를 방지한다.
    const clear = () => router.replace("/account/billing");

    if (failCode) {
      setError(sp.get("message") || "카드 등록이 취소되었거나 실패했습니다.");
      clear();
      return;
    }

    if (billingKey) {
      setBusy(true);
      registerBillingKey(billingKey)
        .then((res) => {
          if (res.ok) {
            setNotice("카드가 등록되었습니다.");
            loadCards();
          } else {
            setError(res.message);
          }
        })
        .finally(() => {
          setBusy(false);
          clear();
        });
    }
    // sp 는 navigation 시마다 갱신되므로 user 기준으로만 1회 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // PC/팝업: 발급창 → 서버 검증·저장.
  async function handleAddCard() {
    setError(null);
    setNotice(null);
    if (!user) return;
    setBusy(true);
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const res = await addBillingCard({
        issueId: `bk_${user.id}_${Date.now()}`,
        issueName: "헤이밀크 정기구독 결제카드 등록",
        redirectUrl: `${origin}/account/billing`,
      });
      if (res.ok) {
        setNotice("카드가 등록되었습니다.");
        await loadCards();
      } else if (res.code !== "REDIRECTING") {
        // REDIRECTING 은 모바일 리디렉션 진행 중(정상) → 복귀 후 처리.
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!ready || (ready && !user)) {
    return (
      <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
        <p className="text-[14px] text-mute">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-32 sm:px-8">
      <Link
        href="/account"
        className="text-[13px] text-mute transition-colors hover:text-gold"
      >
        ← 내 계정
      </Link>
      <h1 className="mt-4 font-serif-kr text-2xl font-medium text-ink">
        정기결제 카드 관리
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
        정기구독은 등록하신 카드로 매주 자동 결제됩니다. 카드 정보는 결제대행사(PG)에
        안전하게 보관되며, 목장은 카드번호 끝 4자리만 확인합니다.
      </p>

      {!isBillingConfigured && (
        <div className="mt-6 rounded-2xl border border-line bg-paper-2/60 px-5 py-4 text-[14px] leading-relaxed text-ink-soft">
          정기결제 시스템을 준비 중입니다. 결제대행사 심사가 완료되면 카드 등록이
          열립니다. 그 전까지는 무통장입금·가상계좌로 이용하실 수 있습니다.
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[14px] leading-relaxed text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4 text-[14px] leading-relaxed text-gold-deep">
          {notice}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-[14px] text-mute">불러오는 중…</p>
        ) : cards.length === 0 ? (
          <p className="rounded-2xl border border-line bg-paper-2/40 px-5 py-6 text-center text-[14px] text-mute">
            등록된 카드가 없습니다.
          </p>
        ) : (
          cards.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-2xl border border-line bg-cream px-5 py-4"
            >
              <div>
                <p className="text-[15px] font-medium text-ink">
                  {c.card_name || "등록 카드"}
                  {c.card_last4 && (
                    <span className="ml-2 tabular-nums text-ink-soft">
                      •••• {c.card_last4}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-[12px] text-mute">
                  {c.pg_provider ? `${c.pg_provider} · ` : ""}
                  {fmtDate(c.issued_at)} 등록
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {isBillingConfigured && (
        <button
          type="button"
          onClick={handleAddCard}
          disabled={busy}
          className="mt-8 w-full rounded-full bg-ink px-6 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "처리 중…" : "카드 등록하기"}
        </button>
      )}
    </div>
  );
}
