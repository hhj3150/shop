"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/products";
import { loadCatalog, type CatalogProduct } from "@/lib/catalog";
import {
  loadClients,
  loadClientPrices,
  loadB2bDemandRange,
  type B2bDemand,
} from "@/lib/clients";
import { profitLine, profitTotals } from "@/lib/profitability";

const RANGE_CAP = 92;

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}
function monthEndISO(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 원가·수익성 — 기간 매출 − 매출원가(COGS) = 이익. 제품별·전체 이익률.
//   매출 = 온라인 수량×판매가 + B2B(거래처 단가). COGS = 원가단가 × 총 판매수량.
//   원가·판매가는 상품·재고(product_catalog)에서 관리한다.
export function ProfitabilityPanel({
  onlineDemandForDate,
}: {
  onlineDemandForDate: (date: string) => Record<string, number>;
}) {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(monthEndISO());
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [prices, setPrices] = useState<Record<string, Record<string, number>>>({});
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [b2bRows, setB2bRows] = useState<B2bDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const endDate = to >= from ? to : from;

  const rangeDates = useMemo<string[]>(() => {
    const out: string[] = [];
    let cur = from;
    for (let i = 0; i < RANGE_CAP; i++) {
      out.push(cur);
      if (cur === endDate) break;
      cur = addDaysISO(cur, 1);
    }
    return out;
  }, [from, endDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [cat, clients, pr, rows] = await Promise.all([
        loadCatalog(),
        loadClients(),
        loadClientPrices(),
        loadB2bDemandRange(from, endDate),
      ]);
      setCatalog(cat);
      setActiveIds(new Set(clients.filter((c) => c.active).map((c) => c.id)));
      setPrices(pr);
      setB2bRows(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [from, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // 온라인 기간 수량(제품키→개수).
  const onlineQty = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of rangeDates) {
      const dem = onlineDemandForDate(d);
      for (const [k, v] of Object.entries(dem)) m[k] = (m[k] ?? 0) + v;
    }
    return m;
  }, [rangeDates, onlineDemandForDate]);

  // B2B 기간 수량·매출(활성 거래처, 거래처 단가 반영).
  const b2b = useMemo(() => {
    const qty: Record<string, number> = {};
    const rev: Record<string, number> = {};
    for (const r of b2bRows) {
      if (!activeIds.has(r.client_id)) continue;
      const price = prices[r.client_id]?.[r.product_key] ?? 0;
      qty[r.product_key] = (qty[r.product_key] ?? 0) + r.qty;
      rev[r.product_key] = (rev[r.product_key] ?? 0) + r.qty * price;
    }
    return { qty, rev };
  }, [b2bRows, activeIds, prices]);

  const lines = useMemo(
    () =>
      catalog.map((p) => {
        const key = `${p.name} ${p.volume}`;
        return {
          ...profitLine({
            productKey: key,
            onlineQty: onlineQty[key] ?? 0,
            b2bQty: b2b.qty[key] ?? 0,
            b2bRevenue: b2b.rev[key] ?? 0,
            cost: p.cost ?? 0,
            price: p.price ?? 0,
          }),
          cost: p.cost ?? 0,
        };
      }),
    [catalog, onlineQty, b2b]
  );

  const totals = useMemo(() => profitTotals(lines), [lines]);
  const hasNoCost = lines.some((l) => l.qty > 0 && l.cost === 0);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">Profit · 원가·수익성</p>
          <h2 className="mt-1 font-serif-kr text-lg text-ink">기간 손익 · 제품별 마진</h2>
          <p className="mt-1 text-[13px] text-mute">
            매출(온라인+B2B) − 매출원가 = 이익. 원가·판매가는 위 ‘상품·재고’에서 관리합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink" />
          <span className="text-mute">~</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink" />
          <button onClick={() => { setFrom(monthStartISO()); setTo(monthEndISO()); }}
            className="rounded-full border border-line px-3 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep">
            이번 달
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">{err}</p>
      )}

      {/* 요약 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="매출" value={formatKRW(totals.revenue)} />
        <Stat label="매출원가" value={formatKRW(totals.cogs)} />
        <Stat label="매출총이익" value={formatKRW(totals.profit)} tone={totals.profit < 0 ? "danger" : "gold"} />
        <Stat label="이익률" value={`${totals.marginPct}%`} tone={totals.profit < 0 ? "danger" : "ink"} />
      </div>

      {/* 제품별 손익 */}
      <div className="mt-6 overflow-x-auto">
        <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[720px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              <th className="py-2 text-right font-normal">판매수량</th>
              <th className="py-2 text-right font-normal">원가단가</th>
              <th className="py-2 text-right font-normal">매출</th>
              <th className="py-2 text-right font-normal">매출원가</th>
              <th className="py-2 text-right font-normal">이익</th>
              <th className="py-2 text-right font-normal">이익률</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-4 text-center text-mute">불러오는 중…</td></tr>
            ) : (
              lines.map((l) => (
                <tr key={l.productKey} className="border-b border-line/60 align-middle">
                  <td data-label="제품" className="py-2.5 text-ink">
                    {l.productKey}
                    {l.qty > 0 && l.cost === 0 && (
                      <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600">원가 미설정</span>
                    )}
                  </td>
                  <td data-label="판매수량" className="py-2.5 text-right tabular-nums text-ink-soft">{l.qty || "·"}</td>
                  <td data-label="원가단가" className="py-2.5 text-right tabular-nums text-ink-soft">{l.cost ? formatKRW(l.cost) : "·"}</td>
                  <td data-label="매출" className="py-2.5 text-right tabular-nums text-ink">{l.revenue ? formatKRW(l.revenue) : "·"}</td>
                  <td data-label="매출원가" className="py-2.5 text-right tabular-nums text-ink-soft">{l.cogs ? formatKRW(l.cogs) : "·"}</td>
                  <td data-label="이익" className={`py-2.5 text-right font-medium tabular-nums ${l.profit < 0 ? "text-red-600" : "text-ink"}`}>
                    {l.revenue ? formatKRW(l.profit) : "·"}
                  </td>
                  <td data-label="이익률" className={`py-2.5 text-right tabular-nums ${l.profit < 0 ? "text-red-600" : "text-gold-deep"}`}>
                    {l.revenue ? `${l.marginPct}%` : "·"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-left">
              <td className="py-2.5 font-medium text-ink">합계</td>
              <td className="py-2.5" />
              <td className="py-2.5" />
              <td className="py-2.5 text-right font-medium tabular-nums text-ink">{formatKRW(totals.revenue)}</td>
              <td className="py-2.5 text-right font-medium tabular-nums text-ink-soft">{formatKRW(totals.cogs)}</td>
              <td className={`py-2.5 text-right font-medium tabular-nums ${totals.profit < 0 ? "text-red-600" : "text-ink"}`}>{formatKRW(totals.profit)}</td>
              <td className={`py-2.5 text-right font-medium tabular-nums ${totals.profit < 0 ? "text-red-600" : "text-gold-deep"}`}>{totals.marginPct}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-4 text-[13px] text-mute">
        매출 = 온라인 수량×판매가 + B2B 수량×거래처 단가. 매출원가 = 원가단가 × 총 판매수량(온라인+B2B).
        {hasNoCost && " 원가가 0인 품목은 이익이 과대 계상되니 ‘상품·재고’에서 원가를 입력하세요."}
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "danger" | "gold";
}) {
  const valueColor = tone === "danger" ? "text-red-600" : tone === "gold" ? "text-gold-deep" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className={`mt-1 font-serif-kr text-xl tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
