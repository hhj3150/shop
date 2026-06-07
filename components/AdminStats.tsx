"use client";

import { useMemo } from "react";
import { formatKRW } from "@/lib/products";
import { DELIVERY_DAYS, DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import {
  cancellationRefundTotal,
  completedReturnRefundTotal,
  netRevenue,
} from "@/lib/revenue";
import type { OrderReturn } from "@/lib/returns";

const CONFIRMED = ["입금확인", "배송준비", "배송중", "배송완료"];

type Order = {
  id: string;
  status: string;
  total_amount: number;
  created_at: string;
  user_id: string;
};
type Item = {
  order_id: string;
  product_name: string;
  volume: string;
  qty: number;
  unit_price: number;
  delivery_day?: DeliveryDay | null;
};
type Slot = {
  delivery_day: DeliveryDay;
  status: string;
  refund_amount?: number | null;
};

const isConfirmed = (status: string) => CONFIRMED.includes(status);

export function AdminStats({
  orders,
  items,
  slots,
  returns,
  memberCount,
}: {
  orders: Order[];
  items: Item[];
  slots: Slot[];
  returns: OrderReturn[];
  memberCount: number;
}) {
  const confirmedIds = useMemo(
    () => new Set(orders.filter((o) => isConfirmed(o.status)).map((o) => o.id)),
    [orders]
  );

  // ── 핵심 지표 ────────────────────────────────────────────
  const kpi = useMemo(() => {
    const confirmed = orders.filter((o) => isConfirmed(o.status));
    const revenue = confirmed.reduce((s, o) => s + o.total_amount, 0);
    const cancelRefunds = cancellationRefundTotal(slots);
    const returnRefunds = completedReturnRefundTotal(returns);
    const net = netRevenue(revenue, cancelRefunds, returnRefunds);
    const aov = confirmed.length ? Math.round(revenue / confirmed.length) : 0;
    const conversion = orders.length
      ? Math.round((confirmed.length / orders.length) * 100)
      : 0;
    const active = slots.filter((s) => s.status === "활성").length;
    const canceled = slots.filter((s) => s.status === "해지").length;
    const retention =
      active + canceled ? Math.round((active / (active + canceled)) * 100) : null;
    return { revenue, net, aov, conversion, active, canceled, retention };
  }, [orders, slots, returns]);

  // ── 재구매율 (확정 주문 2건 이상 회원 비중) ──────────────
  const repeatRate = useMemo(() => {
    const byUser = new Map<string, number>();
    for (const o of orders) {
      if (!isConfirmed(o.status)) continue;
      byUser.set(o.user_id, (byUser.get(o.user_id) ?? 0) + 1);
    }
    const buyers = byUser.size;
    const repeat = Array.from(byUser.values()).filter((n) => n >= 2).length;
    return buyers ? Math.round((repeat / buyers) * 100) : null;
  }, [orders]);

  // ── 요일별 매출 (확정 구독 1회분, 단품은 요일 없음 → 제외) ─
  const dayRevenue = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      if (!confirmedIds.has(it.order_id)) continue;
      if (!it.delivery_day) continue;
      m[it.delivery_day] = (m[it.delivery_day] ?? 0) + it.unit_price * it.qty;
    }
    const rows = DELIVERY_DAYS.map((d) => ({ day: d, revenue: m[d] ?? 0 }));
    const max = Math.max(1, ...rows.map((r) => r.revenue));
    return rows.map((r) => ({ ...r, pct: Math.round((r.revenue / max) * 100) }));
  }, [items, confirmedIds]);

  // ── 요일별 점유율 ────────────────────────────────────────
  const dayOccupancy = useMemo(
    () =>
      DELIVERY_DAYS.map((d) => {
        const taken = slots.filter(
          (s) => s.delivery_day === d && (s.status === "신청" || s.status === "활성")
        ).length;
        return { day: d, taken, pct: Math.min(100, Math.round((taken / 100) * 100)) };
      }),
    [slots]
  );

  // ── 제품별 매출 비중 (확정 구독 1회분 기준) ──────────────
  const productMix = useMemo(() => {
    const m = new Map<string, { revenue: number; qty: number }>();
    for (const it of items) {
      if (!confirmedIds.has(it.order_id)) continue;
      const key = `${it.product_name} ${it.volume}`;
      const cur = m.get(key) ?? { revenue: 0, qty: 0 };
      cur.revenue += it.unit_price * it.qty;
      cur.qty += it.qty;
      m.set(key, cur);
    }
    const rows = Array.from(m.entries()).map(([name, v]) => ({ name, ...v }));
    const total = rows.reduce((s, r) => s + r.revenue, 0);
    return rows
      .map((r) => ({ ...r, pct: total ? Math.round((r.revenue / total) * 100) : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [items, confirmedIds]);

  // ── 주차별 매출 추이 (최근 8주, 확정 기준) ───────────────
  const weekly = useMemo(() => {
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    const dow = (monday.getDay() + 6) % 7; // 월=0
    monday.setDate(monday.getDate() - dow);
    const buckets = Array.from({ length: 8 }, (_, idx) => {
      const i = 7 - idx;
      const start = new Date(monday);
      start.setDate(monday.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      return {
        label: `${start.getMonth() + 1}/${start.getDate()}`,
        start: start.getTime(),
        end: end.getTime(),
        revenue: 0,
        count: 0,
      };
    });
    for (const o of orders) {
      if (!isConfirmed(o.status)) continue;
      const t = new Date(o.created_at).getTime();
      const b = buckets.find((bk) => t >= bk.start && t < bk.end);
      if (b) {
        b.revenue += o.total_amount;
        b.count += 1;
      }
    }
    const max = Math.max(1, ...buckets.map((b) => b.revenue));
    return buckets.map((b) => ({ ...b, pct: Math.round((b.revenue / max) * 100) }));
  }, [orders]);

  return (
    <section id="stats" className="mt-12">
      <h2 className="font-serif-kr text-lg text-ink">통계 분석</h2>
      <p className="mt-1 text-[13px] text-mute">
        확정 구독(입금확인 이후) 기준입니다. 차트의 매출은 1회분 입금액 합계(환불·해지 차감 전 총액)이며,
        순매출은 구독해지 환불과 완료된 제품환불을 차감한 금액입니다.
      </p>

      {/* KPI */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi label="순매출" value={formatKRW(kpi.net)} />
        <Kpi label="회원 수" value={`${memberCount}명`} />
        <Kpi label="활성 구독자" value={`${kpi.active}명`} />
        <Kpi label="평균 주문액" value={formatKRW(kpi.aov)} />
        <Kpi label="입금 전환율" value={`${kpi.conversion}%`} />
        <Kpi
          label="구독 유지율"
          value={kpi.retention === null ? "—" : `${kpi.retention}%`}
        />
        <Kpi label="해지" value={`${kpi.canceled}명`} />
        <Kpi
          label="재구매율"
          value={repeatRate === null ? "—" : `${repeatRate}%`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* 요일별 점유율 */}
        <Card title="요일별 점유율" sub="정원 100명 대비">
          <ul className="space-y-3">
            {dayOccupancy.map((d) => (
              <li key={d.day} className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-[14px] text-ink-soft">
                  {DELIVERY_DAY_LABEL[d.day].charAt(0)}
                </span>
                <Bar pct={d.pct} />
                <span className="w-16 shrink-0 text-right text-[13px] tabular-nums text-mute">
                  {d.taken} / 100
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* 제품별 매출 비중 */}
        <Card title="제품별 매출 비중" sub="확정 구독 1회분">
          {productMix.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-mute">
              확정 구독이 아직 없습니다.
            </p>
          ) : (
            <ul className="space-y-3">
              {productMix.map((p) => (
                <li key={p.name}>
                  <div className="flex items-baseline justify-between text-[14px]">
                    <span className="text-ink">{p.name}</span>
                    <span className="tabular-nums text-mute">
                      {formatKRW(p.revenue)} · {p.pct}%
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <Bar pct={p.pct} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 요일별 매출 */}
      <Card title="요일별 매출" sub="확정 구독 1회분 (단품 제외)" className="mt-6">
        {dayRevenue.every((d) => d.revenue === 0) ? (
          <p className="py-6 text-center text-[14px] text-mute">
            확정 구독이 아직 없습니다.
          </p>
        ) : (
          <ul className="space-y-3">
            {dayRevenue.map((d) => (
              <li key={d.day} className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-[14px] text-ink-soft">
                  {DELIVERY_DAY_LABEL[d.day].charAt(0)}
                </span>
                <Bar pct={d.pct} />
                <span className="w-24 shrink-0 text-right text-[13px] tabular-nums text-mute">
                  {formatKRW(d.revenue)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 주차별 매출 추이 */}
      <Card title="주차별 매출 추이" sub="최근 8주 · 확정 입금 기준" className="mt-6">
        <div className="flex items-end gap-2 sm:gap-3" style={{ height: 160 }}>
          {weekly.map((w) => (
            <div key={w.label} className="flex flex-1 flex-col items-center justify-end">
              <span className="mb-1.5 text-[10px] tabular-nums text-mute">
                {w.revenue > 0 ? `${Math.round(w.revenue / 10000)}만` : ""}
              </span>
              <div
                className="w-full rounded-t-md bg-gold-deep/80 transition-all"
                style={{ height: `${Math.max(2, w.pct)}%`, minHeight: 2 }}
                title={`${w.label} · ${formatKRW(w.revenue)} · ${w.count}건`}
              />
              <span className="mt-2 text-[10.5px] tabular-nums text-mute">{w.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-cream px-4 py-3">
      <p className="text-[11.5px] text-mute">{label}</p>
      <p className="mt-1 font-serif-kr text-[17px] text-ink tabular-nums">{value}</p>
    </div>
  );
}

function Card({
  title,
  sub,
  className = "",
  children,
}: {
  title: string;
  sub?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-paper p-5 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif-kr text-[15px] text-ink">{title}</h3>
        {sub && <span className="text-[11.5px] text-mute">{sub}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full bg-gold-deep transition-all"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}
