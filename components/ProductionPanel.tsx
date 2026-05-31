"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import {
  PRODUCTION_KEYS,
  loadProduction,
  saveProduction,
  loadMilkIntake,
  saveMilkIntake,
  rawMilkLiters,
  type ProductionLog,
} from "@/lib/production";
import { B2bDemandSection } from "@/components/B2bDemandSection";

// 선택 날짜 → 배송 요일(월~금). 주말은 null. (라벨 표시용)
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

// 생산자용 워크스페이스 — 날짜별 원유 입고·생산계획·실제생산 입력 +
//   총 필요량(온라인 + B2B) 대비 부족·잉여, 원유 수지(입고 − 투입) 집계.
//   onlineDemandForDate: 해당 날짜의 온라인 수요(정기 요일분 + 단품 발송분)를 제품키→개수로 반환.
export function ProductionPanel({
  onlineDemandForDate,
}: {
  onlineDemandForDate: (date: string) => Record<string, number>;
}) {
  const [date, setDate] = useState(todayISO());
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [lossPct, setLossPct] = useState(5);
  const [intake, setIntake] = useState(0);
  const [intakeNote, setIntakeNote] = useState("");
  const [b2bTotals, setB2bTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const weekday = useMemo<DeliveryDay | null>(() => {
    const [y, mo, da] = date.split("-").map(Number);
    if (!y) return null;
    return JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()];
  }, [date]);

  // 선택 날짜의 온라인 수요(정기 요일분 + 단품 발송분).
  const onlineDemand = useMemo(
    () => onlineDemandForDate(date),
    [onlineDemandForDate, date]
  );

  const onlineFor = useCallback(
    (key: string): number => onlineDemand[key] ?? 0,
    [onlineDemand]
  );
  const b2bFor = useCallback(
    (key: string): number => b2bTotals[key] ?? 0,
    [b2bTotals]
  );
  const requiredFor = useCallback(
    (key: string): number => onlineFor(key) + b2bFor(key),
    [onlineFor, b2bFor]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const [logs, milk] = await Promise.all([
        loadProduction(date),
        loadMilkIntake(date),
      ]);
      const next: Record<string, DraftRow> = {};
      for (const key of PRODUCTION_KEYS) {
        const row = logs[key];
        next[key] = row
          ? { planned: row.planned, produced: row.produced, note: row.note ?? "" }
          : { ...EMPTY_ROW };
      }
      setDraft(next);
      setIntake(milk?.liters ?? 0);
      setIntakeNote(milk?.note ?? "");
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

  // 총 필요량(온라인 + B2B)을 그대로 생산계획에 채운다 — 생산팀의 기본 계획안.
  //   채운 뒤 제품별로 자유롭게 가감하고 저장(수정 가능)한다.
  const applyRequiredToPlan = () =>
    setDraft((prev) => {
      const next = { ...prev };
      for (const key of PRODUCTION_KEYS) {
        const row = next[key] ?? { ...EMPTY_ROW };
        next[key] = { ...row, planned: requiredFor(key) };
      }
      return next;
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

  // 실제 생산에 투입된 원유 환산(L) = 생산량 기준 원유 추정치.
  const rawUsed = rawMilkLiters(producedQty, lossPct);
  // 생산계획 기준 필요 원유(참고용).
  const rawPlanned = rawMilkLiters(plannedQty, lossPct);
  // 원유 수지 = 당일 입고 − 생산 투입. 음수면 부족.
  const milkBalance = Math.round((intake - rawUsed) * 10) / 10;

  const totalRequired = useMemo(
    () => PRODUCTION_KEYS.reduce((s, k) => s + requiredFor(k), 0),
    [requiredFor]
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
      await Promise.all([
        saveProduction(rows),
        saveMilkIntake(date, intake, intakeNote),
      ]);
      setMsg("생산 기록과 원유 입고를 저장했습니다.");
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
            날짜를 고르면 그 날의 총 필요량(온라인 + 거래처)과 비교해 원유 입고·생산을 기록합니다.
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
            {weekday ? `${DELIVERY_DAY_LABEL[weekday]} · 정기 + 단품` : "주말 — 정기 없음(단품만)"}
          </span>
        </div>
      </div>

      {/* 원유 입고 + 환산 요약 */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="총 필요(개)" value={`${totalRequired}`} />
        <label className="rounded-2xl border border-line bg-cream p-4">
          <span className="text-[13px] text-mute">당일 원유 입고</span>
          <span className="mt-1 flex items-baseline gap-1">
            <input
              type="number"
              min={0}
              step="0.1"
              value={intake || ""}
              onChange={(e) => setIntake(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 rounded-lg border border-line bg-paper px-2 py-1 font-serif-kr text-xl tabular-nums text-ink"
            />
            <span className="font-serif-kr text-xl text-ink">L</span>
          </span>
        </label>
        <Stat
          label="원유 투입 · 생산"
          value={`${rawUsed.toLocaleString("ko-KR")} L`}
        />
        <Stat
          label="원유 수지(입고−투입)"
          value={`${milkBalance > 0 ? "+" : ""}${milkBalance.toLocaleString("ko-KR")} L`}
          tone={milkBalance < 0 ? "danger" : milkBalance > 0 ? "gold" : "mute"}
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

      <div className="mt-3 no-print">
        <input
          type="text"
          value={intakeNote}
          onChange={(e) => setIntakeNote(e.target.value)}
          placeholder="원유 입고 메모 (예: 송영신목장 오전 입고)"
          className="w-full max-w-md rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {err}
        </p>
      )}
      {msg && <p className="mt-4 text-[14px] text-gold-deep">{msg}</p>}

      {/* 생산계획 도우미 */}
      <div className="mt-6 flex flex-wrap items-center gap-3 no-print">
        <button
          onClick={applyRequiredToPlan}
          disabled={loading || totalRequired === 0}
          className="rounded-full border border-gold-deep px-4 py-2 text-[14px] font-medium text-gold-deep hover:bg-gold/10 disabled:opacity-40"
        >
          필요량 → 생산계획 채우기
        </button>
        <span className="text-[13px] text-mute">
          총 필요량을 생산계획으로 옮긴 뒤 제품별로 조정하세요. 생산팀의 기본 계획안이 됩니다.
        </span>
      </div>

      {/* 제품별 생산 표 */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              <th className="py-2 text-right font-normal">온라인</th>
              <th className="py-2 text-right font-normal">B2B</th>
              <th className="py-2 text-right font-normal">총 필요</th>
              <th className="py-2 text-right font-normal">생산계획</th>
              <th className="py-2 text-right font-normal">실제생산</th>
              <th className="py-2 text-right font-normal">부족/잉여</th>
              <th className="py-2 font-normal">메모</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-4 text-center text-mute">
                  불러오는 중…
                </td>
              </tr>
            ) : (
              PRODUCTION_KEYS.map((key) => {
                const row = draft[key] ?? EMPTY_ROW;
                const online = onlineFor(key);
                const b2b = b2bFor(key);
                const required = online + b2b;
                const gap = row.produced - required;
                return (
                  <tr key={key} className="border-b border-line/60 align-middle">
                    <td className="py-2.5 text-ink">{key}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {online || "·"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-soft">
                      {b2b || "·"}
                    </td>
                    <td className="py-2.5 text-right font-medium tabular-nums text-ink">
                      {required || "·"}
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
          {saving ? "저장 중…" : "생산 기록 · 원유 입고 저장"}
        </button>
        <button
          onClick={load}
          disabled={loading || saving}
          className="rounded-full border border-line px-5 py-3 text-[14px] text-ink-soft hover:border-gold hover:text-gold disabled:opacity-50"
        >
          되돌리기
        </button>
        <span className="text-[13px] text-mute">
          총 필요 = 온라인(정기+단품) + 거래처. 부족(−)은 빨강, 잉여(+)는 금색. 원유 환산은 추정치입니다.
        </span>
      </div>

      {/* 거래처(B2B) 필요량 — 저장 시 제품별 합계가 위 표의 B2B에 반영됩니다. */}
      <B2bDemandSection date={date} onTotals={setB2bTotals} />

      {/* 참고: 생산계획 기준 필요 원유 */}
      <p className="mt-4 text-[13px] text-mute">
        참고 · 생산계획 기준 필요 원유: {rawPlanned.toLocaleString("ko-KR")} L
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
