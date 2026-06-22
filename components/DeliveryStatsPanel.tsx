"use client";

// 관리자: 배송 통계·리드타임 — shipment_log(회차별 배송 레코드)에서 발송/배송완료 건수,
//   리드타임(발송→도착), 완료율, 지연, 택배사별 성과를 기간으로 집계해 보여준다.
//   집계는 lib/delivery-stats(SSOT, 순수)로 하고 여기선 조회·표시만 한다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadShipmentStatRows } from "@/lib/inventory-data";
import { computeDeliveryStats, type ShipmentStatRow } from "@/lib/delivery-stats";
import { courierLabel } from "@/lib/couriers";
import { toISODate } from "@/lib/ship-date";

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

export function DeliveryStatsPanel() {
  const [from, setFrom] = useState(() => daysAgoISO(29)); // 최근 30일
  const [to, setTo] = useState(() => toISODate(new Date()));
  const [rows, setRows] = useState<ShipmentStatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadShipmentStatRows(from, to);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // 마운트·기간 변경 시 조회. 데이터 패칭이라 effect 내 setState(로딩 표시)는 의도된 동작.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const stats = useMemo(
    () => computeDeliveryStats(rows, { asOfISO: new Date().toISOString() }),
    [rows]
  );

  const leadLabel = (d: number | null) => (d == null ? "—" : `${d}일`);

  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">배송 통계 · 리드타임</h3>
          <p className="mt-0.5 text-[12.5px] text-mute">
            회차별 출고·도착 기록 기준. 발송일 기간으로 집계합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-ink"
          />
          <span className="text-mute">~</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-ink"
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg bg-ink px-3 py-1.5 font-medium text-cream transition-colors hover:bg-gold-deep disabled:opacity-40"
          >
            {loading ? "조회 중…" : "조회"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
      )}

      {/* 요약 카드 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="발송" value={`${stats.shipped}`} unit="건" />
        <Stat label="배송완료" value={`${stats.delivered}`} unit="건" tone="emerald" />
        <Stat label="진행중" value={`${stats.inTransit}`} unit="건" tone="sky" />
        <Stat label="완료율" value={`${stats.deliveredRate}`} unit="%" />
        <Stat label="평균 리드타임" value={leadLabel(stats.avgLeadDays)} sub={`중앙값 ${leadLabel(stats.medianLeadDays)}`} />
        <Stat
          label="지연(3일+ 미도착)"
          value={`${stats.overdue}`}
          unit="건"
          tone={stats.overdue > 0 ? "red" : undefined}
        />
      </div>

      {/* 택배사별 */}
      {stats.byCourier.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-2 text-[13px] font-semibold text-ink-soft">택배사별</h4>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="py-1.5 font-normal">택배사</th>
                <th className="py-1.5 text-right font-normal">발송</th>
                <th className="py-1.5 text-right font-normal">배송완료</th>
                <th className="py-1.5 text-right font-normal">완료율</th>
                <th className="py-1.5 text-right font-normal">평균 리드타임</th>
              </tr>
            </thead>
            <tbody>
              {stats.byCourier.map((c) => {
                const rate = c.shipped > 0 ? Math.round((c.delivered / c.shipped) * 100) : 0;
                return (
                  <tr key={c.courier || "etc"} className="border-b border-line/60">
                    <td className="py-1.5 text-ink">{courierLabel(c.courier) || "미지정"}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink">{c.shipped}</td>
                    <td className="py-1.5 text-right tabular-nums text-emerald-700">{c.delivered}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-soft">{rate}%</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-soft">{leadLabel(c.avgLeadDays)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && stats.shipped === 0 && !error && (
        <p className="mt-4 text-[13px] text-mute">이 기간에 출고된 배송이 없습니다.</p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "emerald" | "sky" | "red";
}) {
  const valueColor =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "sky"
        ? "text-sky-700"
        : tone === "red"
          ? "text-red-700"
          : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-cream px-3 py-2.5">
      <p className="text-[11.5px] text-mute">{label}</p>
      <p className={`mt-0.5 text-[18px] font-semibold tabular-nums ${valueColor}`}>
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-normal text-mute">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-mute">{sub}</p>}
    </div>
  );
}
