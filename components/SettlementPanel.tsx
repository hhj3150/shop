"use client";

// 관리자: 매출 정산 + 세금계산 + 마진 분석 (월 단위).
//   확정 주문(입금확인 이후)의 상품 매출을 과세/면세로 나누고, 과세분의
//   공급가액·부가세(10%)를 계산한다. product_catalog 의 원가로 마진도 함께 낸다.
//   상품 매출 기준(배송비 제외). 무통장입금 수기운영의 월 마감용 표.
import { useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";
import { loadCatalog, type CatalogProduct } from "@/lib/catalog";

const CONFIRMED = ["입금확인", "배송준비", "배송중", "배송완료"];

// 정산에 필요한 주문 최소 필드.
type SettleOrder = {
  id: string;
  status: string;
  created_at: string;
};

type LineItem = {
  order_id: string;
  product_id: string;
  product_name: string;
  volume: string;
  qty: number;
  unit_price: number;
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 과세 포함가 → 공급가액(원 단위 반올림). 부가세 = 포함가 − 공급가액.
function supplyAmount(taxIncluded: number): number {
  return Math.round(taxIncluded / 1.1);
}

export function SettlementPanel({ orders }: { orders: SettleOrder[] }) {
  const [items, setItems] = useState<LineItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = getSupabase();
        const [{ data, error: itemErr }, cat] = await Promise.all([
          sb
            .from("order_items")
            .select("order_id, product_id, product_name, volume, qty, unit_price"),
          loadCatalog(),
        ]);
        if (itemErr) throw itemErr;
        if (!alive) return;
        setItems((data as LineItem[]) ?? []);
        setCatalog(cat);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 상품 id → { 원가, 면세여부 }.
  const catById = useMemo(() => {
    const m = new Map<string, { cost: number; taxFree: boolean }>();
    for (const c of catalog) m.set(c.id, { cost: c.cost, taxFree: c.tax_free });
    return m;
  }, [catalog]);

  // 선택 월의 확정 주문 id.
  const monthOrderIds = useMemo(() => {
    const s = new Set<string>();
    for (const o of orders) {
      if (!CONFIRMED.includes(o.status)) continue;
      if ((o.created_at ?? "").slice(0, 7) === month) s.add(o.id);
    }
    return s;
  }, [orders, month]);

  // 월 라인아이템 집계.
  const summary = useMemo(() => {
    let taxableGross = 0;
    let taxFreeGross = 0;
    let totalCost = 0;
    const byProduct = new Map<
      string,
      { name: string; volume: string; qty: number; revenue: number; cost: number }
    >();
    for (const it of items) {
      if (!monthOrderIds.has(it.order_id)) continue;
      const meta = catById.get(it.product_id);
      const revenue = it.unit_price * it.qty;
      const cost = (meta?.cost ?? 0) * it.qty;
      if (meta?.taxFree) taxFreeGross += revenue;
      else taxableGross += revenue;
      totalCost += cost;
      const key = it.product_id || `${it.product_name} ${it.volume}`;
      const cur = byProduct.get(key) ?? {
        name: it.product_name,
        volume: it.volume,
        qty: 0,
        revenue: 0,
        cost: 0,
      };
      cur.qty += it.qty;
      cur.revenue += revenue;
      cur.cost += cost;
      byProduct.set(key, cur);
    }
    const supply = supplyAmount(taxableGross);
    const vat = taxableGross - supply;
    const revenue = taxableGross + taxFreeGross;
    const margin = revenue - totalCost;
    const marginRate = revenue > 0 ? Math.round((margin / revenue) * 100) : 0;
    const rows = Array.from(byProduct.values())
      .map((r) => ({ ...r, margin: r.revenue - r.cost }))
      .sort((a, b) => b.revenue - a.revenue);
    return {
      taxableGross,
      taxFreeGross,
      supply,
      vat,
      revenue,
      totalCost,
      margin,
      marginRate,
      rows,
      orderCount: monthOrderIds.size,
    };
  }, [items, monthOrderIds, catById]);

  function exportCsv() {
    const head = ["제품", "용량", "수량", "매출", "원가", "마진"];
    const lines = summary.rows.map((r) =>
      [r.name, r.volume, r.qty, r.revenue, r.cost, r.margin].join(",")
    );
    const foot = [
      "",
      ["과세매출", summary.taxableGross].join(","),
      ["면세매출", summary.taxFreeGross].join(","),
      ["공급가액(과세)", summary.supply].join(","),
      ["부가세(10%)", summary.vat].join(","),
      ["총매출", summary.revenue].join(","),
      ["총원가", summary.totalCost].join(","),
      ["총마진", summary.margin].join(","),
    ];
    const csv = "﻿" + [head.join(","), ...lines, ...foot].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `정산_${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <p className="mt-8 text-[14px] text-mute">정산 데이터 불러오는 중…</p>;
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">매출 정산 · 세금</h2>
        <div className="flex items-center gap-2 no-print">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
          />
          <button
            onClick={exportCsv}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
          >
            CSV
          </button>
        </div>
      </div>
      <p className="mt-1 text-[13px] text-mute">
        확정 주문 상품 매출 기준(배송비 제외) · {month} · {summary.orderCount}건
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      {/* 세금 요약 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="과세 매출" value={formatKRW(summary.taxableGross)} />
        <Cell label="면세 매출" value={formatKRW(summary.taxFreeGross)} />
        <Cell label="공급가액(과세)" value={formatKRW(summary.supply)} />
        <Cell label="부가세 10%" value={formatKRW(summary.vat)} tone="gold" />
        <Cell label="총 매출" value={formatKRW(summary.revenue)} />
        <Cell label="총 마진" value={formatKRW(summary.margin)} sub={`${summary.marginRate}%`} tone="gold" />
      </div>

      {/* 제품별 매출·원가·마진 */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-paper p-5">
        <h3 className="font-serif-kr text-[15px] text-ink">제품별 정산</h3>
        {summary.rows.length === 0 ? (
          <p className="mt-4 py-6 text-center text-[14px] text-mute">
            해당 월 확정 매출이 없습니다.
          </p>
        ) : (
          <table className="mt-3 w-full min-w-[560px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12.5px] text-mute">
                <th className="py-2 pr-3 font-medium">제품</th>
                <th className="py-2 pr-3 text-right font-medium">수량</th>
                <th className="py-2 pr-3 text-right font-medium">매출</th>
                <th className="py-2 pr-3 text-right font-medium">원가</th>
                <th className="py-2 text-right font-medium">마진</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={`${r.name} ${r.volume}`} className="border-b border-line/70">
                  <td className="py-2.5 pr-3 text-ink">
                    {r.name} <span className="text-mute">{r.volume}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-ink-soft">{r.qty}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                    {formatKRW(r.revenue)}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-mute">
                    {formatKRW(r.cost)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-ink">
                    {formatKRW(r.margin)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-medium">
                <td className="py-2.5 pr-3 text-ink">합계</td>
                <td className="py-2.5 pr-3" />
                <td className="py-2.5 pr-3 text-right tabular-nums text-ink">
                  {formatKRW(summary.revenue)}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-mute">
                  {formatKRW(summary.totalCost)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-gold-deep">
                  {formatKRW(summary.margin)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <p className="mt-4 text-[12.5px] text-mute">
        ※ 부가세는 과세 매출의 공급가액 기준 추정치입니다. 면세(우유)는 부가세가
        없습니다. 실제 신고는 세무 자료로 확정하세요.
      </p>
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "gold";
}) {
  return (
    <div className="rounded-2xl border border-line bg-cream px-4 py-3">
      <p className="text-[11.5px] text-mute">{label}</p>
      <p
        className={`mt-1 font-serif-kr text-[16px] tabular-nums ${
          tone === "gold" ? "text-gold-deep" : "text-ink"
        }`}
      >
        {value}
        {sub ? <span className="ml-1 text-[12px] text-mute">{sub}</span> : null}
      </p>
    </div>
  );
}
