"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import {
  PRODUCTION_KEYS,
  rawMilkBaseLiters,
  rawMilkForPeriod,
} from "@/lib/production";
import { loadClients, loadB2bDemandRange, type B2bDemand } from "@/lib/clients";

// 선택 날짜 → 배송 요일(월~금). 주말은 null(정기 없음, 단품만).
const JS_DAY_TO_KEY: Record<number, DeliveryDay | null> = {
  0: null,
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: null,
};

const RANGE_CAP = 92; // 기간 최대 일수 가드.

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayKey(iso: string): DeliveryDay | null {
  const [y, mo, da] = iso.split("-").map(Number);
  if (!y) return null;
  return JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()];
}

// 기간 생산계획 — 시작·종료일을 자유롭게 고르면 그 기간의 온라인(정기+단품)과
//   B2B(거래처) 수요를 합산해 제품별 총 필요량과 필요 원유(L)를 한눈에 보여준다.
//   읽기 전용 집계(계획 참고용) — 날짜별 생산 기록은 아래 생산 패널에서 개별 저장한다.
//   onlineDemandForDate: 해당 날짜의 온라인 수요(정기 요일분 + 단품 발송분)를 제품키→개수로 반환.
export function ProductionPlanPeriod({
  onlineDemandForDate,
}: {
  onlineDemandForDate: (date: string) => Record<string, number>;
}) {
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDaysISO(todayISO(), 6)); // 기본 1주.
  const [lossL, setLossL] = useState(20);
  const [b2bRows, setB2bRows] = useState<B2bDemand[]>([]);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const endDate = to >= from ? to : from;

  // 기간 날짜 목록(시작~종료, 최대 92일).
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
      const [clients, rows] = await Promise.all([
        loadClients(),
        loadB2bDemandRange(from, endDate),
      ]);
      setActiveIds(new Set(clients.filter((c) => c.active).map((c) => c.id)));
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

  // 온라인 기간 합계 + 날짜별 내역(개수·원유L).
  const online = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) totals[key] = 0;
    const perDay: { date: string; wd: DeliveryDay | null; count: number; liters: number }[] = [];
    for (const d of rangeDates) {
      const dem = onlineDemandForDate(d);
      const dayQ: Record<string, number> = {};
      let dayCount = 0;
      for (const key of PRODUCTION_KEYS) {
        const q = dem[key] ?? 0;
        totals[key] += q;
        dayQ[key] = q;
        dayCount += q;
      }
      perDay.push({ date: d, wd: weekdayKey(d), count: dayCount, liters: rawMilkBaseLiters(dayQ) });
    }
    return { totals, perDay };
  }, [rangeDates, onlineDemandForDate]);

  // B2B 기간 합계(활성 거래처만) + 납품일 집합.
  const b2b = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) totals[key] = 0;
    const days = new Set<string>();
    for (const r of b2bRows) {
      if (!activeIds.has(r.client_id)) continue;
      if (totals[r.product_key] === undefined) continue;
      totals[r.product_key] += r.qty;
      if (r.qty > 0) days.add(r.demand_date);
    }
    return { totals, days };
  }, [b2bRows, activeIds]);

  const required = useMemo(() => {
    const m: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) {
      m[key] = (online.totals[key] ?? 0) + (b2b.totals[key] ?? 0);
    }
    return m;
  }, [online.totals, b2b.totals]);

  // 생산일수(추정) = 온라인 배송일 ∪ B2B 납품일. 로스는 이 횟수만큼 가산.
  const productionDays = useMemo(() => {
    const days = new Set<string>();
    for (const p of online.perDay) if (p.count > 0) days.add(p.date);
    for (const d of b2b.days) days.add(d);
    return days.size;
  }, [online.perDay, b2b.days]);

  const totalReqCount = useMemo(
    () => PRODUCTION_KEYS.reduce((s, k) => s + (required[k] ?? 0), 0),
    [required]
  );
  const totalOnline = useMemo(
    () => PRODUCTION_KEYS.reduce((s, k) => s + (online.totals[k] ?? 0), 0),
    [online.totals]
  );
  const totalB2b = useMemo(
    () => PRODUCTION_KEYS.reduce((s, k) => s + (b2b.totals[k] ?? 0), 0),
    [b2b.totals]
  );

  const baseMilk = rawMilkBaseLiters(required);
  const lossMilk = totalReqCount > 0 ? Math.round(lossL * productionDays * 10) / 10 : 0;
  const totalMilk = rawMilkForPeriod(required, lossL, productionDays);

  return (
    <section className="mt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">Production Plan · 기간 생산계획</p>
          <h2 className="mt-1 font-serif-kr text-lg text-ink">기간 필요량 · 원유 계획</h2>
          <p className="mt-1 text-[13px] text-mute">
            시작·종료일을 자유롭게 골라 그 기간의 온라인(정기+단품)과 거래처(B2B) 수요를
            합산하고, 필요한 원유량을 계산합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
          />
          <span className="text-mute">~</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
          />
          <div className="flex gap-1">
            <Quick label="오늘" onClick={() => { setFrom(todayISO()); setTo(todayISO()); }} />
            <Quick label="1주" onClick={() => { setFrom(todayISO()); setTo(addDaysISO(todayISO(), 6)); }} />
            <Quick label="1개월" onClick={() => { setFrom(todayISO()); setTo(addDaysISO(todayISO(), 29)); }} />
          </div>
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {err}
        </p>
      )}

      {/* 요약 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="기간" value={`${rangeDates.length}일`} />
        <Stat label="생산일수(추정)" value={`${productionDays}일`} />
        <Stat label="총 필요(개)" value={totalReqCount.toLocaleString("ko-KR")} />
        <Stat label="순 원유(제품)" value={`${baseMilk.toLocaleString("ko-KR")} L`} />
        <label className="rounded-2xl border border-line bg-cream p-4">
          <span className="text-[13px] text-mute">회당 로스(고정)</span>
          <span className="mt-1 flex items-baseline gap-1">
            <input
              type="number"
              min={0}
              step="0.1"
              value={lossL}
              onChange={(e) => setLossL(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 rounded-lg border border-line bg-paper px-2 py-1 font-serif-kr text-xl tabular-nums text-ink"
            />
            <span className="font-serif-kr text-xl text-ink">L</span>
          </span>
        </label>
        <Stat
          label="기간 필요 원유"
          value={`${totalMilk.toLocaleString("ko-KR")} L`}
          tone="gold"
        />
      </div>

      {/* 제품별 기간 필요량 */}
      <div className="mt-6 overflow-x-auto">
        <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[640px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              <th className="py-2 text-right font-normal">온라인</th>
              <th className="py-2 text-right font-normal">B2B</th>
              <th className="py-2 text-right font-normal">총 필요</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-mute">불러오는 중…</td>
              </tr>
            ) : (
              PRODUCTION_KEYS.map((key) => {
                const on = online.totals[key] ?? 0;
                const bb = b2b.totals[key] ?? 0;
                return (
                  <tr key={key} className="border-b border-line/60 align-middle">
                    <td data-label="제품" className="py-2.5 text-ink">{key}</td>
                    <td data-label="온라인" className="py-2.5 text-right tabular-nums text-ink-soft">{on || "·"}</td>
                    <td data-label="B2B" className="py-2.5 text-right tabular-nums text-ink-soft">{bb || "·"}</td>
                    <td data-label="총 필요" className="py-2.5 text-right font-medium tabular-nums text-ink">{on + bb || "·"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-left">
              <td className="py-2.5 font-medium text-ink">합계</td>
              <td className="py-2.5 text-right font-medium tabular-nums text-ink">{totalOnline || "·"}</td>
              <td className="py-2.5 text-right font-medium tabular-nums text-gold-deep">{totalB2b || "·"}</td>
              <td className="py-2.5 text-right font-medium tabular-nums text-ink">{totalReqCount || "·"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 날짜별 온라인 필요 원유 */}
      <div className="mt-6">
        <p className="text-[13px] font-medium text-ink">날짜별 온라인 수요·원유(참고)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[520px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="py-2 font-normal">날짜</th>
                <th className="py-2 font-normal">요일</th>
                <th className="py-2 text-right font-normal">온라인(개)</th>
                <th className="py-2 text-right font-normal">순 원유(L)</th>
              </tr>
            </thead>
            <tbody>
              {online.perDay.map((p) => (
                <tr key={p.date} className="border-b border-line/60 align-middle">
                  <td data-label="날짜" className="py-2 tabular-nums text-ink">{p.date}</td>
                  <td data-label="요일" className="py-2 text-mute">
                    {p.wd ? DELIVERY_DAY_LABEL[p.wd] : "주말"}
                  </td>
                  <td data-label="온라인" className="py-2 text-right tabular-nums text-ink-soft">{p.count || "·"}</td>
                  <td data-label="순 원유" className="py-2 text-right tabular-nums text-ink-soft">
                    {p.liters ? p.liters.toLocaleString("ko-KR") : "·"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-mute">
        기간 필요 원유 = 순 원유(제품 용량 합) + 회당 로스 {lossL}L × 생산일수 {productionDays}회.
        B2B는 활성 거래처의 저장된 필요량 합계입니다. 원유 환산은 추정치입니다.
      </p>
    </section>
  );
}

function Quick({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-line px-3 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
    >
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "danger" | "gold" | "mute";
}) {
  const valueColor =
    tone === "danger"
      ? "text-red-600"
      : tone === "gold"
        ? "text-gold-deep"
        : tone === "mute"
          ? "text-mute"
          : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className={`mt-1 font-serif-kr text-xl tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
