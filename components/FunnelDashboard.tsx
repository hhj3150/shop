"use client";

// 관리자 퍼널 대시보드 — 익명 세션 기반 5단계 전환율(기간 선택).
//   방문 → 상품조회 → 장바구니 → 체크아웃 → 주문완료. funnel_summary RPC(관리자 전용).
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

const STAGES = [
  { key: "visit", label: "방문" },
  { key: "view_product", label: "상품 조회" },
  { key: "add_to_cart", label: "장바구니 담기" },
  { key: "begin_checkout", label: "체크아웃" },
  { key: "purchase", label: "주문 완료" },
] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayISO() {
  return isoOf(new Date());
}
function daysAgoISO(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
}
function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function FunnelDashboard() {
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(todayISO());
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getSupabase().rpc("funnel_summary", { p_from: from, p_to: to });
    setCounts((data as Record<string, number>) ?? {});
    setLoading(false);
    setLoaded(true);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const top = counts[STAGES[0].key] ?? 0;
  const purchase = counts.purchase ?? 0;
  const hasData = STAGES.some((s) => (counts[s.key] ?? 0) > 0);

  return (
    <div className="rounded-2xl border border-line bg-cream p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-ink" aria-hidden />
          <h2 className="font-serif-kr text-lg text-ink">전환 퍼널</h2>
          <span className="text-[12px] text-mute">익명 세션 기준</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink" />
          <span className="text-mute">~</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink" />
          {[7, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setFrom(daysAgoISO(d - 1));
                setTo(todayISO());
              }}
              className="rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-soft hover:border-gold hover:text-gold-deep"
            >
              {d}일
            </button>
          ))}
        </div>
      </div>

      {/* 핵심 지표 */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-ink/8 px-3 py-1 text-[13px] text-ink">방문 {top.toLocaleString()}</span>
        <span className="rounded-full bg-gold/15 px-3 py-1 text-[13px] font-medium text-gold-deep">
          전체 전환율 {pct(purchase, top)}%
        </span>
        <span className="rounded-full bg-ink/8 px-3 py-1 text-[13px] text-ink">주문 {purchase.toLocaleString()}</span>
      </div>

      {/* 단계 막대 */}
      <div className="mt-4 space-y-2.5">
        {STAGES.map((s, i) => {
          const c = counts[s.key] ?? 0;
          const prev = i === 0 ? c : counts[STAGES[i - 1].key] ?? 0;
          const widthPct = pct(c, top);
          const stepPct = i === 0 ? 100 : pct(c, prev);
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-ink">{s.label}</span>
                <span className="tabular-nums text-ink-soft">
                  {c.toLocaleString()}
                  {i > 0 && <span className="ml-2 text-[12px] text-mute">이전 단계 대비 {stepPct}%</span>}
                </span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-paper-2">
                <div className="h-full rounded-full bg-gold-deep" style={{ width: `${Math.max(widthPct, c > 0 ? 2 : 0)}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {loaded && !hasData && !loading && (
        <p className="mt-4 text-[13px] text-mute">
          아직 측정된 데이터가 없습니다. (마이그레이션 적용 후 방문·주문이 쌓이면 표시됩니다)
        </p>
      )}
    </div>
  );
}
