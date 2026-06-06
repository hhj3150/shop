"use client";

// 마이페이지 친구 추천 카드 — 내 추천코드/링크 공유 + 받은 보상 내역.
//   추천인·피추천인 각 REFERRAL_REWARD_KRW(5,000원). 친구의 첫 정기구독 결제 확정 시 양쪽 지급.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";
import { formatKRW } from "@/lib/products";
import { shareOrCopy } from "@/lib/share";
import { REFERRAL_REWARD_KRW, referralLink } from "@/lib/referral";

type Reward = { amount_krw: number; status: "earned" | "applied" | "void" };

export function ReferralCard() {
  const { ready, user } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const sb = getSupabase();
      const [{ data: c }, { data: rw }] = await Promise.all([
        sb.rpc("get_or_create_my_referral_code"),
        sb
          .from("referral_rewards")
          .select("amount_krw,status")
          .eq("user_id", user.id),
      ]);
      if (typeof c === "string") setCode(c);
      setRewards((rw as Reward[]) ?? []);
    } catch {
      // 표시용 — 실패해도 카드 자체는 안내문으로 노출
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready || !user) return null;

  const link = code ? referralLink(code, SITE_URL) : null;
  const earned = rewards
    .filter((r) => r.status === "earned")
    .reduce((s, r) => s + r.amount_krw, 0);
  const applied = rewards
    .filter((r) => r.status === "applied")
    .reduce((s, r) => s + r.amount_krw, 0);

  async function onShare() {
    if (!link) return;
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const writeText = nav?.clipboard?.writeText
      ? (t: string) => nav.clipboard.writeText(t)
      : undefined;
    if (!writeText) {
      setToast(`링크를 직접 복사해 보내주세요: ${link}`);
      setTimeout(() => setToast(null), 5000);
      return;
    }
    try {
      const res = await shareOrCopy(
        {
          share: nav?.share ? (d) => nav.share(d) : undefined,
          writeText,
        },
        {
          title: "송영신목장 · 친구 추천",
          text: `송영신목장 A2 저지 헤이밀크, 추천코드로 가입하면 둘 다 ${formatKRW(
            REFERRAL_REWARD_KRW
          )} 혜택!`,
          url: link,
        }
      );
      if (res === "copied") {
        setToast("추천 링크가 복사됐어요. 카톡에 붙여넣어 보내보세요.");
        setTimeout(() => setToast(null), 3000);
      }
    } catch {
      setToast(`공유에 실패했어요. 링크를 직접 복사해 주세요: ${link}`);
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border-2 border-hey-green/40 bg-gradient-to-br from-hey-green/10 via-cream to-cream p-6">
      <p className="eyebrow text-hey-green">Refer a Friend</p>
      <h3 className="mt-2 font-serif-kr text-lg font-medium text-ink">친구 추천하고 둘 다 혜택</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-mute">
        내 추천코드로 친구가 가입해 첫 정기구독을 시작하면, 추천한 분과 친구 모두{" "}
        <b className="text-ink">{formatKRW(REFERRAL_REWARD_KRW)}</b> 혜택을 받아요.
      </p>

      {code ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-line bg-cream px-3 py-1.5 font-mono text-[15px] font-semibold tracking-widest text-ink">
            {code}
          </span>
          <button
            type="button"
            onClick={onShare}
            className="rounded-full bg-hey-green px-4 py-1.5 text-[13px] font-semibold text-cream transition-transform hover:scale-[1.03] active:scale-95"
          >
            추천 링크 공유
          </button>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-mute">{loading ? "코드 준비 중…" : "코드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요."}</p>
      )}

      <dl className="mt-4 flex gap-6 text-[13px]">
        <div>
          <dt className="text-mute">받은 보상(지급 예정)</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatKRW(earned)}</dd>
        </div>
        <div>
          <dt className="text-mute">적용 완료</dt>
          <dd className="mt-0.5 font-semibold text-ink">{formatKRW(applied)}</dd>
        </div>
      </dl>

      {toast && (
        <p role="status" className="mt-3 text-[13px] text-hey-green">
          {toast}
        </p>
      )}
    </div>
  );
}
