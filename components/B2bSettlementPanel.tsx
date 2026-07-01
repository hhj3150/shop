"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/products";
import { PRODUCTION_KEYS } from "@/lib/production";
import {
  type Client,
  type B2bDemand,
  loadClients,
  loadClientPrices,
  saveClientPrices,
  loadB2bDemandRange,
} from "@/lib/clients";
import {
  settleClient,
  aggregateDemandByClient,
} from "@/lib/b2b-settlement";

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

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// B2B 매출·정산 — 기간(월 단위 기본)의 거래처별 납품 수량 × 단가로 거래명세·매출을 낸다.
//   거래처별 제품 단가를 이 화면에서 직접 입력·저장한다. 거래명세서 CSV 내보내기 지원.
export function B2bSettlementPanel() {
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(monthEndISO());
  const [clients, setClients] = useState<Client[]>([]);
  const [priceDraft, setPriceDraft] = useState<Record<string, Record<string, number>>>({});
  const [b2bRows, setB2bRows] = useState<B2bDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const endDate = to >= from ? to : from;
  const activeClients = useMemo(() => clients.filter((c) => c.active), [clients]);
  const activeIds = useMemo(() => new Set(activeClients.map((c) => c.id)), [activeClients]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const [cs, prices, rows] = await Promise.all([
        loadClients(),
        loadClientPrices(),
        loadB2bDemandRange(from, endDate),
      ]);
      setClients(cs);
      setB2bRows(rows);
      // 단가 초안: 저장된 값으로 채우되, 없는 칸은 0.
      const draft: Record<string, Record<string, number>> = {};
      for (const c of cs) {
        draft[c.id] = {};
        for (const key of PRODUCTION_KEYS) draft[c.id][key] = prices[c.id]?.[key] ?? 0;
      }
      setPriceDraft(draft);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [from, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // 거래처별 기간 납품 수량(활성만).
  const qtyByClient = useMemo(
    () => aggregateDemandByClient(b2bRows, activeIds),
    [b2bRows, activeIds]
  );

  const setPrice = (clientId: string, key: string, value: string) =>
    setPriceDraft((prev) => ({
      ...prev,
      [clientId]: { ...(prev[clientId] ?? {}), [key]: Math.max(0, Number(value) || 0) },
    }));

  async function handleSavePrices(clientId: string) {
    setSavingId(clientId);
    setErr(null);
    setMsg(null);
    try {
      await saveClientPrices(clientId, priceDraft[clientId] ?? {});
      setMsg("거래처 단가를 저장했습니다.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했습니다.");
    } finally {
      setSavingId(null);
    }
  }

  // 거래처별 정산(순수 계산) — 소계·합계.
  const settlements = useMemo(() => {
    const m: Record<string, ReturnType<typeof settleClient>> = {};
    for (const c of activeClients) {
      m[c.id] = settleClient(PRODUCTION_KEYS, qtyByClient[c.id] ?? {}, priceDraft[c.id] ?? {});
    }
    return m;
  }, [activeClients, qtyByClient, priceDraft]);

  const grandTotal = useMemo(
    () => activeClients.reduce((s, c) => s + (settlements[c.id]?.amountTotal ?? 0), 0),
    [activeClients, settlements]
  );
  const grandQty = useMemo(
    () => activeClients.reduce((s, c) => s + (settlements[c.id]?.qtyTotal ?? 0), 0),
    [activeClients, settlements]
  );

  function exportCsv() {
    const rows: string[][] = [
      ["거래처", "제품", "수량", "단가", "금액", "기간"],
    ];
    for (const c of activeClients) {
      const s = settlements[c.id];
      if (!s || s.lines.length === 0) continue;
      for (const line of s.lines) {
        rows.push([
          c.name,
          line.productKey,
          String(line.qty),
          String(line.unitPrice),
          String(line.amount),
          `${from}~${endDate}`,
        ]);
      }
      rows.push([`${c.name} 소계`, "", String(s.qtyTotal), "", String(s.amountTotal), ""]);
    }
    rows.push(["전체 합계", "", String(grandQty), "", String(grandTotal), `${from}~${endDate}`]);
    downloadCsv(`B2B거래명세_${from}_${endDate}.csv`, rows);
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">B2B · 매출·정산</p>
          <h2 className="mt-1 font-serif-kr text-lg text-ink">거래처 납품 매출·거래명세</h2>
          <p className="mt-1 text-[13px] text-mute">
            기간의 거래처별 납품 수량 × 단가로 매출을 계산합니다. 거래처 단가를 여기서 입력·저장하세요.
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
          <button
            onClick={() => { setFrom(monthStartISO()); setTo(monthEndISO()); }}
            className="rounded-full border border-line px-3 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
          >
            이번 달
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="거래처(활성)" value={`${activeClients.length}곳`} />
        <Stat label="납품 수량" value={`${grandQty.toLocaleString("ko-KR")}개`} />
        <Stat label="기간 매출" value={formatKRW(grandTotal)} tone="gold" />
        <div className="flex items-end no-print">
          <button
            onClick={exportCsv}
            disabled={loading || grandTotal === 0}
            className="w-full rounded-2xl border border-gold-deep px-4 py-3 text-[14px] font-medium text-gold-deep hover:bg-gold/10 disabled:opacity-40"
          >
            거래명세서 CSV
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">{err}</p>
      )}
      {msg && <p className="mt-4 text-[14px] text-gold-deep">{msg}</p>}

      {/* 거래처별 명세 */}
      <div className="mt-6 space-y-6">
        {loading ? (
          <p className="py-4 text-center text-mute">불러오는 중…</p>
        ) : activeClients.length === 0 ? (
          <p className="py-4 text-center text-mute">
            활성 거래처가 없습니다. ‘생산·재고’ 탭의 B2B 섹션에서 거래처를 먼저 추가하세요.
          </p>
        ) : (
          activeClients.map((c) => {
            const s = settlements[c.id];
            const qty = qtyByClient[c.id] ?? {};
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-cream/40 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-serif-kr text-[15px] text-ink">
                    {c.name}
                    {c.contact && <span className="ml-1 text-[12px] text-mute">· {c.contact}</span>}
                  </h3>
                  <span className="text-[14px] font-medium text-gold-deep">
                    소계 {formatKRW(s?.amountTotal ?? 0)}
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[520px]">
                    <thead>
                      <tr className="border-b border-line text-left text-mute">
                        <th className="py-2 font-normal">제품</th>
                        <th className="py-2 text-right font-normal">수량</th>
                        <th className="py-2 text-right font-normal">단가(원)</th>
                        <th className="py-2 text-right font-normal">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PRODUCTION_KEYS.map((key) => {
                        const q = qty[key] ?? 0;
                        const price = priceDraft[c.id]?.[key] ?? 0;
                        return (
                          <tr key={key} className="border-b border-line/60 align-middle">
                            <td data-label="제품" className="py-2.5 text-ink">{key}</td>
                            <td data-label="수량" className="py-2.5 text-right tabular-nums text-ink-soft">{q || "·"}</td>
                            <td data-label="단가" className="py-2.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step="10"
                                value={price || ""}
                                onChange={(e) => setPrice(c.id, key, e.target.value)}
                                className="w-24 rounded-lg border border-line bg-paper px-2 py-1 text-right tabular-nums text-ink"
                              />
                            </td>
                            <td data-label="금액" className="py-2.5 text-right font-medium tabular-nums text-ink">
                              {q * price ? formatKRW(q * price) : "·"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center gap-3 no-print">
                  <button
                    onClick={() => handleSavePrices(c.id)}
                    disabled={savingId === c.id}
                    className="rounded-full border border-gold-deep px-4 py-2 text-[13px] font-medium text-gold-deep hover:bg-gold/10 disabled:opacity-50"
                  >
                    {savingId === c.id ? "저장 중…" : "단가 저장"}
                  </button>
                  <span className="text-[12.5px] text-mute">
                    수량 {s?.qtyTotal ?? 0}개 · 소계 {formatKRW(s?.amountTotal ?? 0)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-6 text-[13px] text-mute">
        매출 = Σ(거래처 납품 수량 × 단가). 수량은 ‘생산·재고’ 탭 B2B 섹션에 저장된 날짜별 필요량의
        기간 합계입니다. 단가는 거래처·제품별로 저장됩니다(부가세 별도 여부는 운영 정책에 따름).
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
  tone?: "ink" | "gold" | "mute";
}) {
  const valueColor = tone === "gold" ? "text-gold-deep" : tone === "mute" ? "text-mute" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className={`mt-1 font-serif-kr text-xl tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}
