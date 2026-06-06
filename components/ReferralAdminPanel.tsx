"use client";

// 관리자 리퍼럴 대시보드 — 추천 현황 + 보상 원장(획득/적용/무효).
//   약속 보증: 획득한 모든 보상이 여기 노출되고, 적용/무효를 직접 처리한다.
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";

type Reward = {
  id: string;
  role: "referrer" | "referee";
  amount_krw: number;
  status: "earned" | "applied" | "void";
  note: string | null;
  applied_at: string | null;
};
type Row = {
  id: string;
  status: "pending" | "qualified" | "void";
  code: string;
  created_at: string;
  qualified_at: string | null;
  referrer_name: string | null;
  referee_name: string | null;
  rewards: Reward[];
};

const STATUS_LABEL: Record<Row["status"], string> = {
  pending: "⚪ 대기",
  qualified: "🟢 성사",
  void: "✖ 취소",
};
const ROLE_LABEL: Record<Reward["role"], string> = { referrer: "추천인", referee: "친구" };
const REWARD_LABEL: Record<Reward["status"], string> = {
  earned: "지급예정",
  applied: "적용완료",
  void: "무효",
};

export function ReferralAdminPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase().rpc("referral_admin_list");
    if (!error && Array.isArray(data)) setRows(data as Row[]);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(rpc: "referral_reward_mark_applied" | "referral_reward_void", id: string) {
    if (busyId) return;
    const note =
      rpc === "referral_reward_void"
        ? (typeof window !== "undefined" ? window.prompt("무효 사유(선택):") ?? undefined : undefined)
        : undefined;
    if (rpc === "referral_reward_void" && typeof window !== "undefined" && note === undefined) {
      // prompt 취소 시 진행 안 함
      return;
    }
    setBusyId(id);
    setMsg(null);
    try {
      const { error } = await getSupabase().rpc(rpc, { p_id: id, p_note: note ?? null });
      if (error) {
        setMsg(`처리 실패: ${error.message}`);
        return;
      }
      setMsg(rpc === "referral_reward_mark_applied" ? "적용 처리했습니다." : "무효 처리했습니다.");
      await load();
    } catch {
      setMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  const totalEarned = rows
    .flatMap((r) => r.rewards)
    .filter((w) => w.status === "earned")
    .reduce((s, w) => s + w.amount_krw, 0);

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-hey-green/40 bg-gradient-to-br from-hey-green/10 via-cream to-cream shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-hey-green to-hey-green/80 px-5 py-3 text-cream">
        <div className="flex items-center gap-2">
          <span className="text-[18px]" aria-hidden>🤝</span>
          <h2 className="font-serif-kr text-lg font-medium">친구 추천 현황</h2>
        </div>
        <span className="text-[13px] font-semibold">지급예정 합계 {formatKRW(totalEarned)}</span>
      </div>

      <div className="p-5">
        {msg && (
          <p className="mb-2 rounded-lg bg-hey-green/15 px-3 py-2 text-[13px] font-medium text-hey-green">{msg}</p>
        )}
        {loaded && rows.length === 0 ? (
          <p className="text-[13px] text-mute">아직 추천 내역이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium text-ink">
                    {r.referrer_name ?? "—"} → {r.referee_name ?? "—"}
                  </span>
                  <span className="text-mute">{STATUS_LABEL[r.status]}</span>
                  <span className="font-mono text-[12px] text-mute">{r.code}</span>
                  <span className="text-[12px] text-mute tabular-nums">
                    {new Date(r.created_at).toLocaleDateString("ko-KR")}
                  </span>
                </div>
                {r.rewards.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {r.rewards.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-mute">{ROLE_LABEL[w.role]}</span>
                        <span className="font-semibold text-ink">{formatKRW(w.amount_krw)}</span>
                        <span className="text-mute">{REWARD_LABEL[w.status]}</span>
                        {w.note && <span className="text-[11.5px] text-mute">· {w.note}</span>}
                        {w.status === "earned" && (
                          <span className="flex gap-1 no-print">
                            <button
                              type="button"
                              onClick={() => act("referral_reward_mark_applied", w.id)}
                              disabled={busyId === w.id}
                              className="rounded-full bg-hey-green px-2.5 py-0.5 text-[11.5px] font-semibold text-cream disabled:opacity-60"
                            >
                              적용
                            </button>
                            <button
                              type="button"
                              onClick={() => act("referral_reward_void", w.id)}
                              disabled={busyId === w.id}
                              className="rounded-full border border-line px-2.5 py-0.5 text-[11.5px] font-medium text-hey-deep-orange disabled:opacity-60"
                            >
                              무효
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
