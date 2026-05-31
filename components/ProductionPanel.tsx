"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import {
  PRODUCTION_KEYS,
  loadProduction,
  saveProduction,
  rawMilkLiters,
  type ProductionLog,
} from "@/lib/production";

// 선택 날짜 → 배송 요일(월~금). 주말은 null.
const JS_DAY_TO_KEY: Record<number, DeliveryDay | null> = {
  0: null,
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: null,
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type DraftRow = { planned: number; produced: number; note: string };

const EMPTY_ROW: DraftRow = { planned: 0, produced: 0, note: "" };

// 생산자용 워크스페이스 — 날짜별 생산계획/실제생산 입력 + 수요 대비 부족·잉여.
//   demand(matrix): 확정 구독 기준 요일별·제품별 주간 필요수량.
export function ProductionPanel({
  matrix,
}: {
  matrix: Record<string, Record<DeliveryDay, number>>;
}) {
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [lossPct, setLossPct] = useState(5);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const weekday = useMemo<DeliveryDay | null>(() => {
    const [y, mo, da] = date.split("-").map(Number);
    if (!y) return null;
    return JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()];
  }, [date]);

  // 선택 날짜 요일의 제품별 수요(필요수량). 주말이면 0.
  const demandFor = useCallback(
    (key: string): number => (weekday ? matrix[key]?.[weekday] ?? 0 : 0),
    [matrix, weekday]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const logs = await loadProduction(date);
      const next: Record<string, DraftRow> = {};
      for (const key of PRODUCTION_KEYS) {
        const row = logs[key];
        next[key] = row
          ? { planned: row.planned, produced: row.produced, note: row.note ?? "" }
          : { ...EMPTY_ROW };
      }
      setDraft(next);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key: string, field: keyof DraftRow, value: string) =>
    setDraft((prev) => {
      const row = prev[key] ?? { ...EMPTY_ROW };
      const next =
        field === "note"
          ? { ...row, note: value }
          : { ...row, [field]: Math.max(0, Number(value) || 0) };
      return { ...prev, [key]: next };
    });

  const plannedQty = useMemo(() => {
    const m: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) m[key] = draft[key]?.planned ?? 0;
    return m;
  }, [draft]);

  const producedQty = useMemo(() => {
    const m: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) m[key] = draft[key]?.produced ?? 0;
    return m;
  }, [draft]);

  const rawPlanned = rawMilkLiters(plannedQty, lossPct);
  const rawProduced = rawMilkLiters(producedQty, lossPct);

  const totalDemand = useMemo(
    () => PRODUCTION_KEYS.reduce((s, k) => s + demandFor(k), 0),
    [demandFor]
  );

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const rows: ProductionLog[] = PRODUCTION_KEYS.map((key) => ({
        prod_date: date,
        product_key: key,
        planned: draft[key]?.planned ?? 0,
        produced: draft[key]?.produced ?? 0,
        note: draft[key]?.note ?? "",
      }));
      await saveProduction(rows);
      setMsg("저장되었습니다.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">Production · 생산자</p>
          <h2 className="mt-1 font-serif-kr text-lg text-ink">생산·재고 관리</h2>
          <p className="mt-1 text-[13px] text-mute">
            날짜를 고르면 그 요일의 확정 구독 수요와 비교해 생산계획·실제생산을 기록합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
          />
          <span className="text-[14px] text-mute">
            {weekday ? `${DELIVERY_DAY_LABEL[weekday]} 수요` : "주말 — 배송 없음"}
          </span>
        </div>
      </div>

      {/* 원유 환산 요약 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="총 수요(개)" value={`${totalDemand}`} />
        <Stat
          label="원유 환산 · 계획"
          value={`${rawPlanned.toLocaleString("ko-KR")} L`}
        />
        <Stat
          label="원유 환산 · 생산"
          value={`${rawProduced.toLocaleString("ko-KR")} L`}
        />
        <label className="rounded-2xl border border-line bg-cream p-4">
          <span className="text-[13px] text-mute">손실·여유율</span>
          <span className="mt-1 flex items-baseline gap-1">
            <input
              type="number"
              min={0}
              value={lossPct}
              onChange={(e) => setLossPct(Math.max(0, Number(e.target.value) || 0))}
              className="w-16 rounded-lg border border-line bg-paper px-2 py-1 font-serif-kr text-xl tabular-nums text-ink"
            />
            <span className="font-serif-kr text-xl text-ink">%</span>
          </span>
        </label>
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {err}
        </p>
      )}
      {msg && <p className="mt-4 text-[14px] text-gold-deep">{msg}</p>}

      {/* 제품별 생산 표 */}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              <th className="py-2 text-right font-normal">필요(수요)</th>
              <th className="py-2 text-right font-normal">생산계획</th>
              <th className="py-2 text-right font-normal">실제생산</th>
              <th className="py-2 text-right font-normal">부족/잉여</th>
              <th className="py-2 font-normal">메모</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-mute">
                  불러오는 중…
                </td>
              </tr>
            ) : (
              PRODUCTION_KEYS.map((key) => {
                const row = draft[key] ?? EMPTY_ROW;
                const demand = demandFor(key);
                const gap = row.produced - demand;
                return (
                  <tr key={key} className="border-b border-line/60 align-middle">
                    <td className="py-2.5 text-ink">{key}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {demand || "·"}
                    </td>
                    <td className="py-2.5 text-right">
                      <input
                        type="number"
                        min={0}
                        value={row.planned || ""}
                        onChange={(e) => setField(key, "planned", e.target.value)}
                        className="w-20 rounded-lg border border-line bg-cream px-2 py-1 text-right tabular-nums text-ink"
                      />
                    </td>
                    <td className="py-2.5 text-right">
                      <input
                        type="number"
                        min={0}
                        value={row.produced || ""}
                        onChange={(e) => setField(key, "produced", e.target.value)}
                        className="w-20 rounded-lg border border-line bg-cream px-2 py-1 text-right tabular-nums text-ink"
                      />
                    </td>
                    <td
                      className={`py-2.5 text-right font-medium tabular-nums ${
                        gap < 0
                          ? "text-red-600"
                          : gap > 0
                            ? "text-gold-deep"
                            : "text-mute"
                      }`}
                    >
                      {gap === 0 ? "0" : gap > 0 ? `+${gap}` : gap}
                    </td>
                    <td className="py-2.5">
                      <input
                        type="text"
                        value={row.note}
                        onChange={(e) => setField(key, "note", e.target.value)}
                        placeholder="비고"
                        className="w-full min-w-[120px] rounded-lg border border-line bg-cream px-2 py-1 text-ink"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 no-print">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-cream transition-transform hover:scale-[1.02] disabled:opacity-50"
        >
          {saving ? "저장 중…" : "생산 기록 저장"}
        </button>
        <button
          onClick={load}
          disabled={loading || saving}
          className="rounded-full border border-line px-5 py-3 text-[14px] text-ink-soft hover:border-gold hover:text-gold disabled:opacity-50"
        >
          되돌리기
        </button>
        <span className="text-[13px] text-mute">
          부족(−)은 빨강, 잉여(+)는 금색. 원유 환산은 용량 합계에 손실·여유율을 더한 추정치입니다.
        </span>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className="mt-1 font-serif-kr text-xl text-ink tabular-nums">{value}</p>
    </div>
  );
}
