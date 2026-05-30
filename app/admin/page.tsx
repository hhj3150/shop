"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";
import {
  DELIVERY_DAYS,
  DELIVERY_DAY_LABEL,
  type DeliveryDay,
} from "@/lib/cart";

// 자동이체 확인 이후 = 확정 구독 (생산·배송 집계 대상).
const CONFIRMED = ["입금확인", "배송준비", "배송중", "배송완료"] as const;
const STATUSES = [
  "입금대기",
  "입금확인",
  "배송준비",
  "배송중",
  "배송완료",
  "취소",
] as const;

const JS_DAY_TO_KEY: Record<number, DeliveryDay | null> = {
  0: null,
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: null,
};

type OrderRow = {
  id: string;
  user_id: string;
  order_no: string;
  status: string;
  total_amount: number;
  depositor_name: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  memo: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: DeliveryDay;
  qty: number;
  unit_price: number;
};

type SlotRow = {
  id: number;
  user_id: string;
  delivery_day: DeliveryDay;
  status: string;
  started_at: string | null;
  created_at: string;
};

type ProfileRow = { id: string; name: string; phone: string };

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

export default function AdminPage() {
  const router = useRouter();
  const { ready, user, profile } = useAuth();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());

  const isAdmin = Boolean(profile?.is_admin);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/admin");
  }, [ready, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = getSupabase();
    const [o, i, s, p] = await Promise.all([
      sb.from("orders").select("*").order("created_at", { ascending: false }),
      sb.from("order_items").select("*"),
      sb.from("subscription_slots").select("*"),
      sb.from("profiles").select("id, name, phone"),
    ]);
    setOrders((o.data as OrderRow[]) ?? []);
    setItems((i.data as ItemRow[]) ?? []);
    setSlots((s.data as SlotRow[]) ?? []);
    setProfiles((p.data as ProfileRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const confirmedOrderIds = useMemo(
    () => new Set(orders.filter((o) => CONFIRMED.includes(o.status as (typeof CONFIRMED)[number])).map((o) => o.id)),
    [orders]
  );
  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders]
  );
  const nameByUser = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.name])),
    [profiles]
  );
  const phoneByUser = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.phone])),
    [profiles]
  );

  // ── 분석 ────────────────────────────────────────────────
  const revenue = useMemo(
    () =>
      orders
        .filter((o) => confirmedOrderIds.has(o.id))
        .reduce((s, o) => s + o.total_amount, 0),
    [orders, confirmedOrderIds]
  );
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders) m[o.status] = (m[o.status] ?? 0) + 1;
    return m;
  }, [orders]);

  const dayStats = useMemo(() => {
    return DELIVERY_DAYS.map((d) => {
      const taken = slots.filter(
        (s) => s.delivery_day === d && (s.status === "신청" || s.status === "활성")
      ).length;
      const active = slots.filter((s) => s.delivery_day === d && s.status === "활성").length;
      const waitlist = slots.filter((s) => s.delivery_day === d && s.status === "대기").length;
      return { day: d, taken, active, waitlist };
    });
  }, [slots]);

  // ── 요일별·제품별 주간 필요 수량 (확정 구독 기준) ──────────
  const productKeys = useMemo(() => {
    const set = new Map<string, string>();
    for (const it of items) set.set(`${it.product_name} ${it.volume}`, `${it.product_name} ${it.volume}`);
    return Array.from(set.keys()).sort();
  }, [items]);

  const matrix = useMemo(() => {
    const m: Record<string, Record<DeliveryDay, number>> = {};
    for (const key of productKeys) {
      m[key] = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
    }
    for (const it of items) {
      if (!confirmedOrderIds.has(it.order_id)) continue;
      const key = `${it.product_name} ${it.volume}`;
      if (m[key]) m[key][it.delivery_day] += it.qty;
    }
    return m;
  }, [items, productKeys, confirmedOrderIds]);

  // ── 선택 날짜 배송 리스트 ─────────────────────────────────
  const selectedWeekday = useMemo<DeliveryDay | null>(() => {
    const [y, mo, da] = date.split("-").map(Number);
    if (!y) return null;
    return JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()];
  }, [date]);

  const deliveryList = useMemo(() => {
    if (!selectedWeekday) return [];
    const byOrder = new Map<string, ItemRow[]>();
    for (const it of items) {
      if (it.delivery_day !== selectedWeekday) continue;
      if (!confirmedOrderIds.has(it.order_id)) continue;
      const arr = byOrder.get(it.order_id) ?? [];
      arr.push(it);
      byOrder.set(it.order_id, arr);
    }
    return Array.from(byOrder.entries()).map(([orderId, its]) => ({
      order: orderById.get(orderId)!,
      items: its,
    }));
  }, [selectedWeekday, items, confirmedOrderIds, orderById]);

  const deliveryProductTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of deliveryList) {
      for (const it of d.items) {
        const k = `${it.product_name} ${it.volume}`;
        m[k] = (m[k] ?? 0) + it.qty;
      }
    }
    return m;
  }, [deliveryList]);

  // ── 대기자 ───────────────────────────────────────────────
  const waitlist = useMemo(
    () =>
      slots
        .filter((s) => s.status === "대기")
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [slots]
  );

  // ── 액션 ─────────────────────────────────────────────────
  async function updateStatus(order: OrderRow, status: string) {
    const sb = getSupabase();
    await sb.from("orders").update({ status }).eq("id", order.id);
    // 자동이체 확인 → 해당 주문의 슬롯을 활성화하고 시작일 부여(연차 할인 기준).
    if (status === "입금확인") {
      await sb
        .from("subscription_slots")
        .update({ status: "활성", started_at: todayISO() })
        .eq("order_id", order.id)
        .eq("status", "신청");
    }
    await load();
  }

  function exportDayCsv(day: DeliveryDay) {
    const rows: string[][] = [
      ["주문번호", "이름", "연락처", "우편번호", "주소", "상세주소", "제품(수량)", "상태"],
    ];
    for (const o of orders) {
      if (!confirmedOrderIds.has(o.id)) continue;
      const its = items.filter((it) => it.order_id === o.id && it.delivery_day === day);
      if (its.length === 0) continue;
      rows.push([
        o.order_no,
        o.ship_name,
        o.ship_phone,
        o.ship_postcode ?? "",
        o.ship_address,
        o.ship_address_detail ?? "",
        its.map((it) => `${it.product_name} ${it.volume}×${it.qty}`).join(" / "),
        o.status,
      ]);
    }
    downloadCsv(`배송명단_${DELIVERY_DAY_LABEL[day]}.csv`, rows);
  }

  if (!ready || (user && profile === null)) {
    return <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute">불러오는 중…</div>;
  }
  if (!user) return null;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center">
        <p className="font-serif-kr text-lg text-ink">관리자 전용 페이지입니다.</p>
        <p className="mt-2 text-[14px] text-mute">접근 권한이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 pt-28 sm:px-8" id="report">
      <style>{`@media print { .no-print { display: none !important; } #report { padding-top: 0 !important; } }`}</style>

      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">Admin · 물류 ERP</p>
          <h1 className="mt-2 font-serif-kr text-[clamp(1.6rem,4vw,2.2rem)] font-medium text-ink">
            송영신목장 관리자
          </h1>
        </div>
        <div className="flex gap-2 no-print">
          <button onClick={load} className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold">
            새로고침
          </button>
          <button onClick={() => window.print()} className="rounded-full bg-ink px-4 py-2 text-[13px] text-cream hover:bg-gold-deep">
            보고서 출력
          </button>
        </div>
      </div>

      {loading && <p className="mt-8 text-[14px] text-mute">데이터 불러오는 중…</p>}

      {/* 개요 */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="회원 수" value={`${profiles.length}명`} />
        <Stat label="총 주문" value={`${orders.length}건`} />
        <Stat label="확정 구독 매출" value={formatKRW(revenue)} />
        <Stat label="대기자" value={`${waitlist.length}명`} />
      </section>

      {/* 요일별 모집 현황 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">요일별 모집 현황 (정원 100명)</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">요일</th>
              <th className="py-2 text-right font-normal">모집(신청+활성)</th>
              <th className="py-2 text-right font-normal">활성(자동이체확인)</th>
              <th className="py-2 text-right font-normal">잔여</th>
              <th className="py-2 text-right font-normal">대기자</th>
            </tr>
          </thead>
          <tbody>
            {dayStats.map((s) => (
              <tr key={s.day} className="border-b border-line/60">
                <td className="py-2.5 text-ink">{DELIVERY_DAY_LABEL[s.day]}</td>
                <td className="py-2.5 text-right tabular-nums text-ink">{s.taken} / 100</td>
                <td className="py-2.5 text-right tabular-nums text-ink-soft">{s.active}</td>
                <td className="py-2.5 text-right tabular-nums text-gold-deep">{Math.max(0, 100 - s.taken)}</td>
                <td className="py-2.5 text-right tabular-nums text-ink-soft">{s.waitlist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 요일별·제품별 주간 필요 수량 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">요일별·제품별 주간 필요 수량</h2>
      <p className="mt-1 text-[12px] text-mute">확정 구독(자동이체 확인) 기준, 1회(매주) 발송 수량입니다.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              {DELIVERY_DAYS.map((d) => (
                <th key={d} className="py-2 text-right font-normal">{DELIVERY_DAY_LABEL[d].charAt(0)}</th>
              ))}
              <th className="py-2 text-right font-normal">합계</th>
            </tr>
          </thead>
          <tbody>
            {productKeys.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-center text-mute">확정 구독이 아직 없습니다.</td></tr>
            ) : (
              productKeys.map((key) => {
                const row = matrix[key];
                const total = DELIVERY_DAYS.reduce((s, d) => s + row[d], 0);
                return (
                  <tr key={key} className="border-b border-line/60">
                    <td className="py-2.5 text-ink">{key}</td>
                    {DELIVERY_DAYS.map((d) => (
                      <td key={d} className="py-2.5 text-right tabular-nums text-ink-soft">{row[d] || "·"}</td>
                    ))}
                    <td className="py-2.5 text-right font-medium tabular-nums text-ink">{total}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 당일/날짜별 배송 리스트 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">날짜별 배송 명단</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 no-print">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
        <span className="text-[13px] text-mute">
          {selectedWeekday ? `${DELIVERY_DAY_LABEL[selectedWeekday]} 배송분` : "주말은 배송이 없습니다"}
        </span>
        {selectedWeekday && deliveryList.length > 0 && (
          <button
            onClick={() => exportDayCsv(selectedWeekday)}
            className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
          >
            이 요일 명단 CSV
          </button>
        )}
      </div>

      {selectedWeekday && Object.keys(deliveryProductTotals).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(deliveryProductTotals).map(([k, v]) => (
            <span key={k} className="rounded-full bg-gold/10 px-3 py-1 text-[12px] text-gold-deep">
              {k} · {v}개
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">연락처</th>
              <th className="py-2 font-normal">주소</th>
              <th className="py-2 font-normal">제품(수량)</th>
              <th className="py-2 font-normal">상태</th>
            </tr>
          </thead>
          <tbody>
            {!selectedWeekday || deliveryList.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-mute">해당 날짜 배송분이 없습니다.</td></tr>
            ) : (
              deliveryList.map(({ order, items: its }) => (
                <tr key={order.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 text-ink">{order.ship_name}</td>
                  <td className="py-2.5 tabular-nums text-ink-soft">{order.ship_phone}</td>
                  <td className="py-2.5 text-ink-soft">
                    ({order.ship_postcode}) {order.ship_address} {order.ship_address_detail ?? ""}
                  </td>
                  <td className="py-2.5 text-ink-soft">
                    {its.map((it) => `${it.product_name} ${it.volume}×${it.qty}`).join(", ")}
                  </td>
                  <td className="py-2.5 text-gold-deep">{order.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 대기자 명단 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">대기자 명단</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">요일</th>
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">연락처</th>
              <th className="py-2 font-normal">신청일</th>
            </tr>
          </thead>
          <tbody>
            {waitlist.length === 0 ? (
              <tr><td colSpan={4} className="py-4 text-center text-mute">대기자가 없습니다.</td></tr>
            ) : (
              waitlist.map((s) => (
                <tr key={s.id} className="border-b border-line/60">
                  <td className="py-2.5 text-ink">{DELIVERY_DAY_LABEL[s.delivery_day]}</td>
                  <td className="py-2.5 text-ink-soft">{nameByUser.get(s.user_id) ?? "—"}</td>
                  <td className="py-2.5 tabular-nums text-ink-soft">{phoneByUser.get(s.user_id) ?? "—"}</td>
                  <td className="py-2.5 text-mute">{new Date(s.created_at).toLocaleDateString("ko-KR")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 주문 관리 — 상태 변경 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">주문 관리</h2>
      <p className="mt-1 text-[12px] text-mute">상태를 변경하면 저장됩니다. ‘입금확인’으로 바꾸면 자동이체가 확인된 것으로 보고 구독이 활성화됩니다.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">주문번호</th>
              <th className="py-2 font-normal">입금자</th>
              <th className="py-2 text-right font-normal">금액</th>
              <th className="py-2 font-normal">신청일</th>
              <th className="py-2 font-normal no-print">상태</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-mute">주문이 없습니다.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="py-2.5 tabular-nums text-ink">{o.order_no}</td>
                  <td className="py-2.5 text-ink-soft">{o.depositor_name ?? o.ship_name}</td>
                  <td className="py-2.5 text-right tabular-nums text-ink-soft">{formatKRW(o.total_amount)}</td>
                  <td className="py-2.5 text-mute">{new Date(o.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2.5 no-print">
                    <select
                      value={o.status}
                      onChange={(e) => updateStatus(o, e.target.value)}
                      className="rounded-lg border border-line bg-cream px-2 py-1 text-[13px] text-ink"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 상태별 요약 */}
      <div className="mt-8 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <span key={s} className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-soft">
            {s} {statusCounts[s] ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[12px] text-mute">{label}</p>
      <p className="mt-1 font-serif-kr text-xl text-ink tabular-nums">{value}</p>
    </div>
  );
}
