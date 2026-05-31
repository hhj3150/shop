"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";
import {
  DELIVERY_DAYS,
  DELIVERY_DAY_LABEL,
  type DeliveryDay,
} from "@/lib/cart";
import { firstSubscriptionDelivery, toISODate } from "@/lib/ship-date";
import { COURIERS, COURIER_IDS } from "@/lib/couriers";
import { notify } from "@/lib/notify";
import { AdminStats } from "@/components/AdminStats";
import { BroadcastPanel } from "@/components/BroadcastPanel";
import { ProductionPanel } from "@/components/ProductionPanel";

// 역할 탭 — 단일 관리자 계정 안에서 업무별 작업화면을 나눈다.
const TABS = ["종합 관리", "생산·재고"] as const;
type AdminTab = (typeof TABS)[number];

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
  order_type: string; // '구독' | '단품'
  ship_date: string | null; // 단품 발송 예정일 (YYYY-MM-DD)
  total_amount: number;
  depositor_name: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  memo: string | null;
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  renews_slot_id: number | null; // 연장 주문이면 잇는 슬롯 id, 아니면 null
  cash_receipt_type: string | null; // 소득공제 | 지출증빙 | 발행안함
  cash_receipt_id: string | null; // 소득공제: 휴대폰, 지출증빙: 사업자번호
  cash_receipt_issued: boolean | null; // 관리자 수기 발행 완료 여부
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
  order_id: string | null;
  user_id: string;
  delivery_day: DeliveryDay;
  status: string;
  started_at: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  cancel_reason: string | null;
  refund_account: string | null;
  refund_amount: number | null;
  cancelled_at: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  name: string;
  phone: string;
  marketing_consent: boolean;
  postcode: string | null;
  address: string | null;
  address_detail: string | null;
  created_at: string | null;
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 구성품(제품·용량·수량)을 정렬해 만든 표준 문자열. 같은 구성이면 같은 값이 나와 포장 묶음을 만든다.
function compositionSignature(its: ItemRow[]): string {
  return [...its]
    .map((it) => `${it.product_name} ${it.volume}×${it.qty}`)
    .sort((a, b) => a.localeCompare(b, "ko"))
    .join(" / ");
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
  const { ready, user, profile, profileLoaded } = useAuth();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState<AdminTab>("종합 관리");
  const [memberQuery, setMemberQuery] = useState("");

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
      sb
        .from("profiles")
        .select("id, name, phone, marketing_consent, postcode, address, address_detail, created_at"),
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
  // 일시정지 중인 구독의 주문 — 이번 주 발송 집계에서 제외한다(횟수는 보존, 종료일만 밀림).
  const pausedOrderIds = useMemo(
    () =>
      new Set(
        slots
          .filter((s) => s.paused && s.order_id)
          .map((s) => s.order_id as string)
      ),
    [slots]
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
      const paused = slots.filter((s) => s.delivery_day === d && s.paused).length;
      return { day: d, taken, active, waitlist, paused };
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
      if (pausedOrderIds.has(it.order_id)) continue;
      const key = `${it.product_name} ${it.volume}`;
      if (m[key]) m[key][it.delivery_day] += it.qty;
    }
    return m;
  }, [items, productKeys, confirmedOrderIds, pausedOrderIds]);

  // 임의 날짜의 온라인 수요(정기 요일분 + 단품 발송분)를 제품키→개수로. 생산 패널에 전달.
  const onlineDemandForDate = useCallback(
    (d: string): Record<string, number> => {
      const result: Record<string, number> = {};
      const [y, mo, da] = d.split("-").map(Number);
      const wd = y ? JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()] : null;
      if (wd) {
        for (const key of productKeys) {
          const q = matrix[key]?.[wd] ?? 0;
          if (q) result[key] = (result[key] ?? 0) + q;
        }
      }
      for (const it of items) {
        const order = orderById.get(it.order_id);
        if (!order || order.order_type !== "단품") continue;
        if (order.ship_date !== d) continue;
        if (!confirmedOrderIds.has(order.id)) continue;
        const key = `${it.product_name} ${it.volume}`;
        result[key] = (result[key] ?? 0) + it.qty;
      }
      return result;
    },
    [matrix, productKeys, items, orderById, confirmedOrderIds]
  );

  // ── 선택 날짜 배송 리스트 ─────────────────────────────────
  const selectedWeekday = useMemo<DeliveryDay | null>(() => {
    const [y, mo, da] = date.split("-").map(Number);
    if (!y) return null;
    return JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()];
  }, [date]);

  // 한 배송 건(정기 1회분 또는 단품 주문). kind 로 정기/단품을 구분.
  type DeliveryEntry = {
    order: OrderRow;
    items: ItemRow[];
    sig: string;
    kind: "정기" | "단품";
  };

  // 정기는 정기끼리 먼저, 그 안에서 같은 구성품끼리 묶어 정렬한다(포장 편의).
  const deliveryList = useMemo<DeliveryEntry[]>(() => {
    const entries: DeliveryEntry[] = [];

    // ① 정기구독 — 선택 요일에 발송되는 확정·미정지 구독.
    if (selectedWeekday) {
      const byOrder = new Map<string, ItemRow[]>();
      for (const it of items) {
        if (it.delivery_day !== selectedWeekday) continue;
        if (!confirmedOrderIds.has(it.order_id)) continue;
        if (pausedOrderIds.has(it.order_id)) continue;
        const arr = byOrder.get(it.order_id) ?? [];
        arr.push(it);
        byOrder.set(it.order_id, arr);
      }
      for (const [orderId, its] of byOrder) {
        const order = orderById.get(orderId);
        if (!order || order.order_type === "단품") continue;
        entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
      }
    }

    // ② 단품(1회) — 선택한 날짜(ship_date)에 발송 예정인 확정 단품 주문.
    const onceByOrder = new Map<string, ItemRow[]>();
    for (const it of items) {
      const order = orderById.get(it.order_id);
      if (!order || order.order_type !== "단품") continue;
      if (order.ship_date !== date) continue;
      if (!confirmedOrderIds.has(order.id)) continue;
      const arr = onceByOrder.get(order.id) ?? [];
      arr.push(it);
      onceByOrder.set(order.id, arr);
    }
    for (const [orderId, its] of onceByOrder) {
      const order = orderById.get(orderId)!;
      entries.push({ order, items: its, sig: compositionSignature(its), kind: "단품" });
    }

    const rank = (k: DeliveryEntry["kind"]) => (k === "정기" ? 0 : 1);
    return entries.sort(
      (a, b) =>
        rank(a.kind) - rank(b.kind) ||
        a.sig.localeCompare(b.sig, "ko") ||
        a.order.ship_name.localeCompare(b.order.ship_name, "ko")
    );
  }, [selectedWeekday, items, confirmedOrderIds, pausedOrderIds, orderById, date]);

  // 같은 구분·구성품끼리 한 묶음으로. 포장 시 묶음 단위로 처리.
  const deliveryGroups = useMemo(() => {
    const groups: { kind: "정기" | "단품"; sig: string; rows: DeliveryEntry[] }[] = [];
    for (const row of deliveryList) {
      const last = groups[groups.length - 1];
      if (last && last.kind === row.kind && last.sig === row.sig) last.rows.push(row);
      else groups.push({ kind: row.kind, sig: row.sig, rows: [row] });
    }
    return groups;
  }, [deliveryList]);

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

  // ── 해지·환불 처리 대기 ───────────────────────────────────
  const cancellations = useMemo(
    () =>
      slots
        .filter((s) => s.status === "해지" && s.cancelled_at)
        .sort((a, b) => (b.cancelled_at ?? "").localeCompare(a.cancelled_at ?? "")),
    [slots]
  );
  const refundTotal = useMemo(
    () => cancellations.reduce((sum, s) => sum + (s.refund_amount ?? 0), 0),
    [cancellations]
  );

  // ── 회원 전체 ─────────────────────────────────────────────
  // 회원별 주문 건수·활성 구독 수를 함께 묶어 한눈에 본다.
  type MemberRow = ProfileRow & { orderCount: number; activeSubs: number };
  const memberRows = useMemo<MemberRow[]>(() => {
    const orderCountByUser = new Map<string, number>();
    for (const o of orders) {
      orderCountByUser.set(o.user_id, (orderCountByUser.get(o.user_id) ?? 0) + 1);
    }
    const activeByUser = new Map<string, number>();
    for (const s of slots) {
      if (s.status === "활성") activeByUser.set(s.user_id, (activeByUser.get(s.user_id) ?? 0) + 1);
    }
    return [...profiles]
      .map((p) => ({
        ...p,
        orderCount: orderCountByUser.get(p.id) ?? 0,
        activeSubs: activeByUser.get(p.id) ?? 0,
      }))
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [profiles, orders, slots]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return memberRows;
    return memberRows.filter(
      (m) =>
        (m.name ?? "").toLowerCase().includes(q) ||
        (m.phone ?? "").toLowerCase().includes(q) ||
        (m.address ?? "").toLowerCase().includes(q)
    );
  }, [memberRows, memberQuery]);

  function exportMembersCsv() {
    const rows: string[][] = [
      ["이름", "연락처", "우편번호", "주소", "상세주소", "가입일", "마케팅수신", "주문수", "활성구독"],
    ];
    for (const m of memberRows) {
      rows.push([
        m.name ?? "",
        m.phone ?? "",
        m.postcode ?? "",
        m.address ?? "",
        m.address_detail ?? "",
        m.created_at ? new Date(m.created_at).toLocaleDateString("ko-KR") : "",
        m.marketing_consent ? "동의" : "미동의",
        String(m.orderCount),
        String(m.activeSubs),
      ]);
    }
    downloadCsv("회원_전체명단.csv", rows);
  }

  // ── 액션 ─────────────────────────────────────────────────
  async function updateStatus(order: OrderRow, status: string) {
    const sb = getSupabase();
    // 연장 주문 입금확인 → 전용 RPC로 슬롯 회차(+4) 연장과 상태 변경을 원자적으로 처리.
    if (status === "입금확인" && order.renews_slot_id) {
      const { error } = await sb.rpc("confirm_renewal_payment", {
        p_order_id: order.id,
      });
      if (error) {
        alert(error.message);
        return;
      }
      void notify({ kind: "renewal_confirmed", orderId: order.id });
      await load();
      return;
    }
    // 수동 입금확인은 무통장입금 경로다. 결제 기록 컬럼(paid_at/pay_method)을 함께 남겨
    //   PortOne 자동확인 건과 동일한 형태로 조회·정산할 수 있게 한다.
    const patch: Record<string, unknown> = { status };
    if (status === "입금확인") {
      patch.paid_at = new Date().toISOString();
      patch.pay_method = "무통장";
    }
    await sb.from("orders").update(patch).eq("id", order.id);
    // 입금확인 → 슬롯을 활성화하고, 요일별 첫 배송일을 시작일로 부여.
    if (status === "입금확인") {
      const { data: pending } = await sb
        .from("subscription_slots")
        .select("id, delivery_day")
        .eq("order_id", order.id)
        .eq("status", "신청");
      for (const s of (pending ?? []) as { id: number; delivery_day: DeliveryDay }[]) {
        const start = toISODate(firstSubscriptionDelivery(s.delivery_day));
        await sb
          .from("subscription_slots")
          .update({ status: "활성", started_at: start })
          .eq("id", s.id);
      }
      void notify({ kind: "payment_confirmed", orderId: order.id });
    }
    await load();
  }

  // 현금영수증 수기 발행 완료/대기 토글. 홈택스에서 발행한 뒤 표시용으로 기록한다.
  async function toggleReceiptIssued(order: OrderRow) {
    const sb = getSupabase();
    const { error } = await sb.rpc("mark_cash_receipt_issued", {
      p_order_id: order.id,
      p_issued: !order.cash_receipt_issued,
    });
    if (error) {
      alert(error.message);
      return;
    }
    await load();
  }

  // 택배사·송장번호 저장. 송장이 입력되면 상태를 자동으로 '배송중'으로 올리고 발송일 기록.
  async function saveTracking(order: OrderRow, courier: string, trackingNo: string) {
    const sb = getSupabase();
    const tracking = trackingNo.trim();
    const patch: Record<string, unknown> = {
      courier: courier || null,
      tracking_no: tracking || null,
    };
    if (tracking) {
      patch.shipped_at = order.shipped_at ?? todayISO();
      if (order.status === "입금확인" || order.status === "배송준비") {
        patch.status = "배송중";
      }
    }
    await sb.from("orders").update(patch).eq("id", order.id);
    if (tracking) void notify({ kind: "shipped", orderId: order.id });
    await load();
  }

  // 화면의 배송 명단(선택 날짜 기준, 정기+단품)을 그대로 CSV로 내보낸다.
  function exportDeliveryCsv() {
    const rows: string[][] = [
      ["구분", "포장묶음", "주문번호", "이름", "연락처", "우편번호", "주소", "상세주소", "제품(수량)", "상태"],
    ];
    deliveryGroups.forEach((g, gi) => {
      for (const { order: o, items: its } of g.rows) {
        rows.push([
          g.kind,
          String(gi + 1),
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
    });
    const label = selectedWeekday ? DELIVERY_DAY_LABEL[selectedWeekday] : "주말";
    downloadCsv(`배송명단_${date}_${label}.csv`, rows);
  }

  function exportCancellationsCsv() {
    const rows: string[][] = [
      ["해지일", "이름", "연락처", "주문번호", "요일", "환불액", "환불계좌", "사유"],
    ];
    for (const s of cancellations) {
      rows.push([
        s.cancelled_at ?? "",
        nameByUser.get(s.user_id) ?? "",
        phoneByUser.get(s.user_id) ?? "",
        s.order_id ? orderById.get(s.order_id)?.order_no ?? "" : "",
        DELIVERY_DAY_LABEL[s.delivery_day],
        String(s.refund_amount ?? 0),
        s.refund_account ?? "",
        s.cancel_reason ?? "",
      ]);
    }
    downloadCsv("해지환불_명단.csv", rows);
  }

  if (!ready || (user && !profileLoaded)) {
    return <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute">불러오는 중…</div>;
  }
  if (!user) return null;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center">
        <p className="font-serif-kr text-lg text-ink">관리자 전용 페이지입니다.</p>
        <p className="mt-2 text-[14px] text-mute">
          {profile === null
            ? "프로필이 아직 없습니다. 가입을 완료했는지 확인해 주세요."
            : "접근 권한이 없습니다."}
        </p>
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
          <Link href="/admin/news" className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
            소식 전하기
          </Link>
          <button onClick={load} className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
            새로고침
          </button>
          <button onClick={() => window.print()} className="rounded-full bg-ink px-4 py-2 text-[14px] text-cream hover:bg-gold-deep">
            보고서 출력
          </button>
        </div>
      </div>

      {/* 역할 탭 */}
      <div className="mt-6 flex gap-2 border-b border-line no-print">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] font-medium transition-colors ${
              tab === t
                ? "border-gold-deep text-ink"
                : "border-transparent text-mute hover:text-ink-soft"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "생산·재고" && <ProductionPanel onlineDemandForDate={onlineDemandForDate} />}

      {tab === "종합 관리" && (
        <>
      {loading && <p className="mt-8 text-[14px] text-mute">데이터 불러오는 중…</p>}

      {/* 개요 */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="회원 수" value={`${profiles.length}명`} />
        <Stat label="총 주문" value={`${orders.length}건`} />
        <Stat label="확정 구독 매출" value={formatKRW(revenue)} />
        <Stat label="대기자" value={`${waitlist.length}명`} />
      </section>

      {/* 통계 분석 */}
      <AdminStats orders={orders} items={items} slots={slots} memberCount={profiles.length} />

      {/* 회원 전체 */}
      <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif-kr text-lg text-ink">회원 전체 ({memberRows.length}명)</h2>
        <div className="flex items-center gap-2 no-print">
          <input
            type="search"
            value={memberQuery}
            onChange={(e) => setMemberQuery(e.target.value)}
            placeholder="이름·연락처·주소 검색"
            className="w-52 rounded-full border border-line bg-cream px-4 py-2 text-[14px] text-ink placeholder:text-mute"
          />
          {memberRows.length > 0 && (
            <button
              onClick={exportMembersCsv}
              className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold-deep"
            >
              회원 명단 CSV
            </button>
          )}
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">연락처</th>
              <th className="py-2 font-normal">주소</th>
              <th className="py-2 font-normal">가입일</th>
              <th className="py-2 text-center font-normal">마케팅</th>
              <th className="py-2 text-right font-normal">주문</th>
              <th className="py-2 text-right font-normal">활성구독</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-mute">
                  {memberRows.length === 0 ? "회원이 없습니다." : "검색 결과가 없습니다."}
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => (
                <tr key={m.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 text-ink">{m.name || "—"}</td>
                  <td className="py-2.5 tabular-nums text-ink-soft">{m.phone || "—"}</td>
                  <td className="py-2.5 text-ink-soft">
                    {m.address
                      ? `${m.postcode ? `(${m.postcode}) ` : ""}${m.address} ${m.address_detail ?? ""}`
                      : "—"}
                  </td>
                  <td className="py-2.5 text-mute">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString("ko-KR") : "—"}
                  </td>
                  <td className="py-2.5 text-center">
                    {m.marketing_consent ? (
                      <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[12px] text-gold-deep">동의</span>
                    ) : (
                      <span className="text-mute">·</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-ink-soft">{m.orderCount || "·"}</td>
                  <td className="py-2.5 text-right tabular-nums text-gold-deep">{m.activeSubs || "·"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 요일별 모집 현황 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">요일별 모집 현황 (정원 100명)</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">요일</th>
              <th className="py-2 text-right font-normal">모집(신청+활성)</th>
              <th className="py-2 text-right font-normal">활성(입금확인)</th>
              <th className="py-2 text-right font-normal">정지중</th>
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
                <td className="py-2.5 text-right tabular-nums text-ink-soft">{s.paused || "·"}</td>
                <td className="py-2.5 text-right tabular-nums text-gold-deep">{Math.max(0, 100 - s.taken)}</td>
                <td className="py-2.5 text-right tabular-nums text-ink-soft">{s.waitlist}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 요일별·제품별 주간 필요 수량 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">요일별·제품별 주간 필요 수량</h2>
      <p className="mt-1 text-[13px] text-mute">확정 구독(입금 확인) 기준, 1회(매주) 발송 수량입니다. 일시정지 중인 구독은 제외됩니다.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[14px]">
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
        <span className="text-[14px] text-mute">
          {selectedWeekday ? `${DELIVERY_DAY_LABEL[selectedWeekday]} 정기 + 단품 발송분` : "주말 — 정기배송 없음 (단품만)"}
        </span>
        {deliveryList.length > 0 && (
          <button
            onClick={exportDeliveryCsv}
            className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold-deep"
          >
            배송 명단 CSV
          </button>
        )}
      </div>

      {Object.keys(deliveryProductTotals).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(deliveryProductTotals).map(([k, v]) => (
            <span key={k} className="rounded-full bg-gold/10 px-3 py-1 text-[13px] text-gold-deep">
              {k} · {v}개
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
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
            {deliveryList.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-mute">해당 날짜 배송분이 없습니다.</td></tr>
            ) : (
              deliveryGroups.map((g, gi) => (
                <Fragment key={`${g.kind}-${gi}`}>
                  <tr className="bg-gold/8">
                    <td colSpan={5} className="px-1 py-2 text-[13px] font-medium text-gold-deep">
                      <span
                        className={`mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                          g.kind === "단품"
                            ? "bg-ink/10 text-ink"
                            : "bg-gold/20 text-gold-deep"
                        }`}
                      >
                        {g.kind}
                      </span>
                      포장 묶음 {gi + 1} · {g.sig} <span className="text-mute">({g.rows.length}건)</span>
                    </td>
                  </tr>
                  {g.rows.map(({ order, items: its }) => (
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
                  ))}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 대기자 명단 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">대기자 명단</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[14px]">
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

      {/* 해지·환불 처리 명단 */}
      <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif-kr text-lg text-ink">해지·환불 처리</h2>
        <div className="flex items-center gap-3">
          <span className="text-[14px] text-mute">
            환불 합계 <span className="tabular-nums text-gold-deep">{formatKRW(refundTotal)}</span>
          </span>
          {cancellations.length > 0 && (
            <button
              onClick={exportCancellationsCsv}
              className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold-deep no-print"
            >
              환불 명단 CSV
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-mute">회원이 해지 시 입력한 환불 계좌로 남은 회차분을 수동 송금하세요. 환불 완료 여부는 별도로 관리합니다.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">해지일</th>
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">연락처</th>
              <th className="py-2 font-normal">주문번호</th>
              <th className="py-2 font-normal">요일</th>
              <th className="py-2 text-right font-normal">환불액</th>
              <th className="py-2 font-normal">환불계좌</th>
              <th className="py-2 font-normal">사유</th>
            </tr>
          </thead>
          <tbody>
            {cancellations.length === 0 ? (
              <tr><td colSpan={8} className="py-4 text-center text-mute">해지·환불 건이 없습니다.</td></tr>
            ) : (
              cancellations.map((s) => (
                <tr key={s.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 tabular-nums text-ink-soft">{s.cancelled_at}</td>
                  <td className="py-2.5 text-ink">{nameByUser.get(s.user_id) ?? "—"}</td>
                  <td className="py-2.5 tabular-nums text-ink-soft">{phoneByUser.get(s.user_id) ?? "—"}</td>
                  <td className="py-2.5 tabular-nums text-mute">{s.order_id ? orderById.get(s.order_id)?.order_no ?? "—" : "—"}</td>
                  <td className="py-2.5 text-ink-soft">{DELIVERY_DAY_LABEL[s.delivery_day]}</td>
                  <td className="py-2.5 text-right font-medium tabular-nums text-gold-deep">{formatKRW(s.refund_amount ?? 0)}</td>
                  <td className="py-2.5 text-ink-soft">{s.refund_account ?? "—"}</td>
                  <td className="py-2.5 text-ink-soft">{s.cancel_reason ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 단체문자 발송 */}
      <BroadcastPanel profiles={profiles} slots={slots} />

      {/* 주문 관리 — 상태 변경 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">주문 관리</h2>
      <p className="mt-1 text-[13px] text-mute">상태를 변경하면 저장됩니다. ‘입금확인’으로 바꾸면 입금이 확인된 것으로 보고 구독이 활성화됩니다.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">주문번호</th>
              <th className="py-2 font-normal">입금자</th>
              <th className="py-2 text-right font-normal">금액</th>
              <th className="py-2 font-normal">신청일</th>
              <th className="py-2 font-normal">현금영수증</th>
              <th className="py-2 font-normal no-print">상태</th>
              <th className="py-2 font-normal no-print">배송 추적 (택배사·송장)</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-center text-mute">주문이 없습니다.</td></tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 tabular-nums text-ink">
                    {o.order_no}
                    {o.renews_slot_id && (
                      <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold-deep">
                        연장
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-ink-soft">{o.depositor_name ?? o.ship_name}</td>
                  <td className="py-2.5 text-right tabular-nums text-ink-soft">{formatKRW(o.total_amount)}</td>
                  <td className="py-2.5 text-mute">{new Date(o.created_at).toLocaleDateString("ko-KR")}</td>
                  <td className="py-2.5">
                    {o.cash_receipt_type && o.cash_receipt_type !== "발행안함" ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-ink-soft">
                          {o.cash_receipt_type}
                          <span className="ml-1 tabular-nums text-ink">{o.cash_receipt_id ?? ""}</span>
                        </span>
                        <button
                          onClick={() => toggleReceiptIssued(o)}
                          className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-colors no-print ${
                            o.cash_receipt_issued
                              ? "bg-gold/15 text-gold-deep hover:bg-gold/25"
                              : "border border-line text-mute hover:border-gold hover:text-gold-deep"
                          }`}
                        >
                          {o.cash_receipt_issued ? "발행완료" : "발행대기"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-mute">{o.cash_receipt_type === "발행안함" ? "발행안함" : "—"}</span>
                    )}
                  </td>
                  <td className="py-2.5 no-print">
                    <select
                      value={o.status}
                      onChange={(e) => updateStatus(o, e.target.value)}
                      className="rounded-lg border border-line bg-cream px-2 py-1 text-[14px] text-ink"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 no-print">
                    <TrackingCell order={o} onSave={saveTracking} />
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
          <span key={s} className="rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft">
            {s} {statusCounts[s] ?? 0}
          </span>
        ))}
      </div>
        </>
      )}
    </div>
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

function TrackingCell({
  order,
  onSave,
}: {
  order: OrderRow;
  onSave: (order: OrderRow, courier: string, trackingNo: string) => Promise<void>;
}) {
  const [courier, setCourier] = useState(order.courier ?? "cj");
  const [trackingNo, setTrackingNo] = useState(order.tracking_no ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = courier !== (order.courier ?? "cj") || trackingNo !== (order.tracking_no ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(order, courier, trackingNo);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={courier}
        onChange={(e) => setCourier(e.target.value)}
        className="rounded-lg border border-line bg-cream px-2 py-1 text-[13px] text-ink"
      >
        {COURIER_IDS.map((id) => (
          <option key={id} value={id}>
            {COURIERS[id].label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={trackingNo}
        onChange={(e) => setTrackingNo(e.target.value)}
        placeholder="송장번호"
        className="w-32 rounded-lg border border-line bg-cream px-2 py-1 text-[13px] tabular-nums text-ink"
      />
      <button
        onClick={handleSave}
        disabled={!dirty || saving}
        className="rounded-lg bg-ink px-2.5 py-1 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
      >
        {saving ? "…" : "저장"}
      </button>
    </div>
  );
}
