"use client";

// 관리자: 배송 일괄처리 — 결제완료(입금확인 이후) 주문을 한 화면에서 모아
//   택배사·송장번호를 입력하고 상태를 일괄 전환한다.
//   단품은 발송예정일(ship_date), 구독은 요일(delivery_day)로 날짜 필터.
import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { stockShipOut } from "@/lib/inventory-data";
import { notify } from "@/lib/notify";
import { COURIERS, COURIER_IDS, courierLabel } from "@/lib/couriers";
import { DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";
import { dispatchScheduleForSlot } from "@/lib/dispatch-schedule";
import { buildTotalsRow } from "@/lib/dispatch-csv";
import {
  BUCKET_ML,
  BUCKET_LABEL,
  productBucket,
  findUnmappedKeys,
} from "@/lib/dispatch-buckets";

// 배송 처리에 필요한 최소 주문 필드(관리자 페이지 OrderRow 의 부분집합).
type DispatchOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  block_weeks: number | null; // 구독 1회 결제분 회차(연장 전 원 회차)
  renews_slot_id: number | null; // 연장 결제 주문이면 잇는 슬롯 id(품목 미생성·발송 안 함)
  ship_date: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  created_at: string;
  cash_receipt_type: string | null;
  cash_receipt_issued: boolean | null;
};

type DispatchItem = {
  product_name: string;
  volume: string;
  qty: number;
  delivery_day: DeliveryDay | null;
};

// 회차·제외 판정용 슬롯 상태(관리자 SlotRow 의 부분집합).
type DispatchSlot = {
  order_id: string | null;
  started_at: string | null;
  status: string;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
  delivery_day: DeliveryDay | null;
};

// 결제 후 배송 대상 상태(완료·취소·미입금 제외).
const SHIPPABLE = ["입금확인", "배송준비", "배송중"];
const WEEKDAY: readonly (DeliveryDay | null)[] = [
  null, // 일
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  null, // 토
];

function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// 엑셀(한글) 호환 CSV 다운로드 — UTF-8 BOM 포함.
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

// 구독 회차 — 시작일 대비 발송일이 몇 주차인지(1-base). 정지·총회차를 모르는
//   비(非)슬롯 경로(단품 등) 전용 보조 계산. 슬롯이 있으면 dispatchScheduleForSlot 를 쓴다.
//   단품·시작일 미상은 1회로 본다. (과거 %4 순환은 5회차+를 1회차로 위장시켜 제거함.)
function roundFor(orderType: string, shipISO: string, startedISO: string | null): number {
  if (orderType === "단품" || !startedISO) return 1;
  const start = Date.parse(`${startedISO.slice(0, 10)}T00:00:00`);
  const ship = Date.parse(`${shipISO}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(ship) || ship < start) return 1;
  const weeks = Math.floor((ship - start) / (7 * 86_400_000));
  return weeks + 1;
}

// 정렬 가능한 컬럼 키.
type SortKey = "name" | "type" | "day" | "status" | "region" | "count" | "round";

// 한 주문의 배송 작업에 필요한 모든 파생값(품목 수량·합계·요일·회차)을 미리 계산해 둔다.
type DispatchRow = {
  o: DispatchOrder;
  items: DispatchItem[];
  q: number[]; // [우유180, 우유750, 요거트180, 요거트500]
  count: number; // 총 개수
  liters: number; // 총 L량
  dayKey: DeliveryDay | null;
  dayLabel: string;
  round: number; // 이 발송일 기준 회차(1-base)
  total: number; // 총 회차(구독: block_weeks + extended_weeks, 단품: 1)
  remaining: number; // 남은 회차(구독만 의미, 단품 0)
  shipISO: string; // 이 발송 건의 발송(예정)일
  region: string; // 정렬·검색용 지역 문자열
};

export function DispatchPanel({
  orders,
  itemsByOrder,
  slots = [],
  shippedKeys = new Set(),
  onReload,
}: {
  orders: DispatchOrder[];
  itemsByOrder: Map<string, DispatchItem[]>;
  slots?: DispatchSlot[];
  shippedKeys?: Set<string>; // 이미 출고된 `${order_id}|${ship_date}` 키(재고 차감 완료)
  onReload: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(todayISO());
  const [useDateFilter, setUseDateFilter] = useState(true);
  const [courier, setCourier] = useState<string>("cj");
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 검색·필터·정렬 상태.
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"전체" | "구독" | "단품">("전체");
  const [dayFilter, setDayFilter] = useState<"전체" | DeliveryDay>("전체");
  const [statusFilter, setStatusFilter] = useState<string>("전체");
  const [sortKey, setSortKey] = useState<SortKey>("day");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // 이번 화면에서 방금 출고 확정한 행(즉시 비활성). 서버 shippedKeys 와 합쳐 판정.
  const [justShipped, setJustShipped] = useState<Set<string>>(new Set());
  const [shippingId, setShippingId] = useState<string | null>(null);

  // 선택 날짜의 요일(구독 매칭용). 주말이면 null → 구독은 매칭 안 됨.
  const dayOfDate = useMemo<DeliveryDay | null>(() => {
    const d = new Date(`${date}T00:00:00`);
    return WEEKDAY[d.getDay()] ?? null;
  }, [date]);

  // 주문 → 구독 슬롯(회차·제외 판정용). 연장은 원주문을 가리키므로 order_id 로 매핑.
  const slotByOrder = useMemo(() => {
    const m = new Map<string, DispatchSlot>();
    for (const s of slots) if (s.order_id) m.set(s.order_id, s);
    return m;
  }, [slots]);

  // 4개 칸(우유180/750·요거트180/500)에 매핑되지 않는 제품 — 수량·총합·발송명단에서
  //   조용히 빠지므로 화면에 경고해 관리자가 분류 누락을 알아차리게 한다.
  const unmappedKeys = useMemo(() => {
    const its: { product_name: string; volume: string; qty: number }[] = [];
    for (const o of orders) {
      if (!SHIPPABLE.includes(o.status)) continue;
      if (o.renews_slot_id != null) continue;
      for (const it of itemsByOrder.get(o.id) ?? []) its.push(it);
    }
    return findUnmappedKeys(its);
  }, [orders, itemsByOrder]);

  // 배송 가능 주문을 파생값(품목 수량·합계·요일·회차)까지 계산해 행으로 만든다.
  //   제외 대상(해지·일시정지·회차소진 구독, 연장 결제 유령주문)은 큐에서 빼
  //   과배송·오배송을 막는다. 합계도 제외 후 기준이라 시트가 정확해진다.
  const allRows = useMemo<DispatchRow[]>(() => {
    const rows: DispatchRow[] = [];
    for (const o of orders) {
      if (!SHIPPABLE.includes(o.status)) continue;
      // 연장 결제 주문: 품목 미생성·발송은 원주문 행에서 이어짐 → 유령행 제외.
      if (o.renews_slot_id != null) continue;

      const items = itemsByOrder.get(o.id) ?? [];
      const q = [0, 0, 0, 0];
      let dayKey: DeliveryDay | null = null;
      for (const it of items) {
        const b = productBucket(it.product_name, it.volume);
        if (b >= 0) q[b] += it.qty;
        if (it.delivery_day) dayKey = it.delivery_day;
      }
      const count = q.reduce((a, b) => a + b, 0);
      const liters =
        Math.round(q.reduce((sum, n, i) => sum + n * BUCKET_ML[i], 0) / 100) / 10;
      const shipISO = o.ship_date ?? (useDateFilter ? date : o.shipped_at ?? date);
      const region = `${o.ship_postcode ?? ""} ${o.ship_address} ${o.ship_address_detail ?? ""}`.trim();
      const isOnce = o.order_type === "단품";

      // 회차·제외 판정: 슬롯이 있으면 정지·총회차 반영한 정확 계산, 없으면 보조 계산.
      const slot = slotByOrder.get(o.id);
      let round: number;
      let total: number;
      let remaining: number;
      if (!isOnce && slot) {
        const sch = dispatchScheduleForSlot(slot, o.block_weeks ?? 0, shipISO);
        if (sch.excluded) continue; // 해지·일시정지·회차소진 → 큐에서 제외
        round = sch.round;
        total = sch.total;
        remaining = sch.remaining;
      } else {
        round = roundFor(o.order_type, shipISO, slot?.started_at ?? o.created_at);
        total = isOnce ? 1 : 0; // 단품 1회, 슬롯 미상 구독은 총회차 미상(0)
        remaining = 0;
      }

      rows.push({
        o,
        items,
        q,
        count,
        liters,
        dayKey,
        dayLabel: dayKey ? DELIVERY_DAY_LABEL[dayKey] : isOnce ? "단품" : "",
        round,
        total,
        remaining,
        shipISO,
        region,
      });
    }
    return rows;
  }, [orders, itemsByOrder, slotByOrder, useDateFilter, date]);

  // 날짜 → 검색 → 구분/요일/상태 필터 → 정렬. 모든 컬럼 정렬 가능.
  const queue = useMemo<DispatchRow[]>(() => {
    const ql = query.trim().toLowerCase();
    const dayIdx = (d: DeliveryDay | null) => (d ? DELIVERY_DAYS.indexOf(d) : 99);
    const filtered = allRows.filter((r) => {
      const o = r.o;
      if (useDateFilter) {
        if (o.order_type === "단품") {
          if (o.ship_date !== date) return false;
        } else if (!(dayOfDate !== null && r.dayKey === dayOfDate)) {
          return false;
        }
      }
      if (typeFilter !== "전체" && o.order_type !== typeFilter) return false;
      if (dayFilter !== "전체" && r.dayKey !== dayFilter) return false;
      if (statusFilter !== "전체" && o.status !== statusFilter) return false;
      if (ql) {
        const hay = `${o.ship_name} ${o.ship_phone} ${o.order_no} ${r.region}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: DispatchRow, b: DispatchRow): number => {
      switch (sortKey) {
        case "name":
          return a.o.ship_name.localeCompare(b.o.ship_name, "ko") * dir;
        case "type":
          return a.o.order_type.localeCompare(b.o.order_type, "ko") * dir;
        case "day":
          return (dayIdx(a.dayKey) - dayIdx(b.dayKey) || a.round - b.round) * dir;
        case "status":
          return (SHIPPABLE.indexOf(a.o.status) - SHIPPABLE.indexOf(b.o.status)) * dir;
        case "region":
          return a.region.localeCompare(b.region, "ko") * dir;
        case "count":
          return (a.count - b.count) * dir;
        case "round":
          return (a.round - b.round) * dir;
        default:
          return 0;
      }
    };
    return [...filtered].sort(cmp);
  }, [
    allRows, query, typeFilter, dayFilter, statusFilter,
    sortKey, sortDir, useDateFilter, date, dayOfDate,
  ]);

  // 현재 목록의 제품별 합계(개수·L량) — 화면 요약 + 엑셀 합계행 공용.
  const totals = useMemo(() => {
    const q = [0, 0, 0, 0];
    for (const r of queue) for (let i = 0; i < 4; i++) q[i] += r.q[i];
    const liters = q.map((n, i) => Math.round((n * BUCKET_ML[i]) / 100) / 10);
    const litersTotal = Math.round(liters.reduce((a, b) => a + b, 0) * 10) / 10;
    const count = q.reduce((a, b) => a + b, 0);
    return { q, liters, litersTotal, count };
  }, [queue]);

  const allSelected = queue.length > 0 && queue.every((r) => selected.has(r.o.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(queue.map((r) => r.o.id)));
  }

  function trackingOf(o: DispatchOrder): string {
    return tracking[o.id] ?? o.tracking_no ?? "";
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function receiptStatus(o: DispatchOrder): string {
    if (o.cash_receipt_issued) return "발행완료";
    if (o.cash_receipt_type && o.cash_receipt_type !== "발행안함") return "발행필요";
    return "";
  }

  // 배송 행 = (주문, 발송일) 단위. 재고 차감·이중차감 판정의 키.
  function shipKey(r: DispatchRow): string {
    return `${r.o.id}|${r.shipISO}`;
  }

  function isShipped(r: DispatchRow): boolean {
    const k = shipKey(r);
    return shippedKeys.has(k) || justShipped.has(k);
  }

  // 출고 확정 → stock_ship_out 으로 그 발송일분 재고 자동 차감. 주차당 1회만(서버 보장).
  //   성공·이미출고 모두 행을 비활성으로 두고 재고를 재조회한다.
  async function shipOut(r: DispatchRow) {
    const k = shipKey(r);
    setShippingId(k);
    setError(null);
    try {
      await stockShipOut(r.o.id, r.shipISO);
      setJustShipped((prev) => new Set(prev).add(k));
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "출고 처리 실패");
    } finally {
      setShippingId(null);
    }
  }

  // 배송 담당자용 발송 명단 엑셀 — 회차별 발송일 칸 + 제품 수량 + 총개수/총 L량 합계(빠뜨림 방지).
  function exportDispatchCsv() {
    const header = [
      "유입", "이름", "연락처", "우편번호", "주소", "상세주소", "최근주문",
      "구분", "배송요일", "회차", "남은회차", "발송일",
      ...BUCKET_LABEL, "택배사", "송장번호", "소득공발행", "상태",
    ];
    const rows: string[][] = [header];
    for (const r of queue) {
      const o = r.o;
      const courierName = courierLabel(o.courier);
      const isOnce = o.order_type === "단품";
      // 회차/총회차 — 연장(8·12주) 구독도 5회차+ 가 정확히 출력된다.
      const roundCell = isOnce ? "단품" : r.total > 0 ? `${r.round}/${r.total}` : String(r.round);
      const remainCell = !isOnce && r.total > 0 ? String(r.remaining) : "";
      rows.push([
        "", // 유입경로 — 현재 미수집(담당자 기입용)
        o.ship_name,
        o.ship_phone,
        o.ship_postcode ?? "",
        o.ship_address,
        o.ship_address_detail ?? "",
        o.created_at?.slice(0, 10) ?? "",
        isOnce ? "단품" : "구독",
        r.dayLabel,
        roundCell,
        remainCell,
        r.shipISO,
        r.q[0] ? String(r.q[0]) : "",
        r.q[1] ? String(r.q[1]) : "",
        r.q[2] ? String(r.q[2]) : "",
        r.q[3] ? String(r.q[3]) : "",
        courierName,
        trackingOf(o),
        receiptStatus(o),
        o.status,
      ]);
    }
    // 합계: 총 개수 + 총 L량. 제품 칸 위치를 헤더에서 도출해 한 칸 밀림을 막는다.
    const firstBucketIndex = header.indexOf(BUCKET_LABEL[0]);
    rows.push(
      buildTotalsRow({
        label: "총 개수",
        width: header.length,
        firstBucketIndex,
        buckets: totals.q.map((n) => String(n)),
        grandTotal: `${queue.length}건`,
      })
    );
    rows.push(
      buildTotalsRow({
        label: "총 L량",
        width: header.length,
        firstBucketIndex,
        buckets: totals.liters.map((n) => `${n}L`),
        grandTotal: `${totals.litersTotal}L`,
      })
    );
    const tag = useDateFilter ? date : "전체";
    downloadCsv(`발송명단_${tag}.csv`, rows);
  }

  // 선택분 일괄 발송: 송장 입력된 건만 배송중 전환 + 발송일·택배사 기록 + 알림.
  async function bulkShip() {
    const targets = queue
      .filter((r) => selected.has(r.o.id) && trackingOf(r.o).trim())
      .map((r) => r.o);
    if (targets.length === 0) {
      setError("송장번호가 입력된 선택 주문이 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      const results = await Promise.all(
        targets.map((o) =>
          sb
            .from("orders")
            .update({
              courier,
              tracking_no: trackingOf(o).trim(),
              shipped_at: o.shipped_at ?? date,
              status: "배송중",
            })
            .eq("id", o.id)
            .then(({ error }) => ({ o, error }))
        )
      );
      // 업데이트 성공 + 새로 '배송중'으로 전환된 건에만 발송 문자를 보낸다.
      //   (조용한 실패 시 오발송 방지 / 이미 배송중인 건 중복 발송 방지)
      for (const { o, error } of results) {
        if (!error && o.status !== "배송중") void notify({ kind: "shipped", orderId: o.id });
      }
      setSelected(new Set());
      const failed = results.filter((r) => r.error);
      if (failed.length) {
        setError(`${failed.length}건 발송 처리 실패: ${failed[0].error?.message ?? "알 수 없는 오류"}`);
      }
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "일괄 발송 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  // 선택분 상태 일괄 전환(배송준비 / 배송완료).
  async function bulkStatus(status: string) {
    const targets = queue.filter((r) => selected.has(r.o.id)).map((r) => r.o);
    if (targets.length === 0) {
      setError("선택된 주문이 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      const results = await Promise.all(
        targets.map((o) =>
          sb.from("orders").update({ status }).eq("id", o.id).then(({ error }) => ({ o, error }))
        )
      );
      // 배송완료로 전환된 건은 고객에게 배송 완료 안내 발송(업데이트 성공분만).
      //   (배송완료는 SHIPPABLE 큐에서 제외되므로 재선택·중복 발송 위험 없음)
      if (status === "배송완료") {
        for (const { o, error } of results) {
          if (!error) void notify({ kind: "delivered", orderId: o.id });
        }
      }
      setSelected(new Set());
      const failed = results.filter((r) => r.error);
      if (failed.length) {
        setError(`${failed.length}건 상태 전환 실패: ${failed[0].error?.message ?? "알 수 없는 오류"}`);
      }
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "상태 전환 실패");
    } finally {
      setBusy(false);
    }
  }

  // 정렬 가능한 헤더 셀.
  function sortTh(k: SortKey, label: string, extra = "") {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={`cursor-pointer select-none py-2.5 pr-3 font-medium transition-colors hover:text-ink ${active ? "text-ink" : ""} ${extra}`}
      >
        {label}
        <span className="text-gold-deep">{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</span>
      </th>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">배송 일괄처리</h2>
        <div className="flex items-center gap-3 no-print">
          <span className="text-[12.5px] text-mute">
            배송 대상 {queue.length}건 · 선택 {selected.size}건
          </span>
          {queue.length > 0 && (
            <button
              type="button"
              onClick={exportDispatchCsv}
              className="rounded-full border border-gold/50 bg-gold/10 px-3.5 py-1.5 text-[13px] font-semibold text-gold-deep transition-colors hover:bg-gold/20"
            >
              📋 발송 명단 엑셀
            </button>
          )}
        </div>
      </div>

      {/* 검색 + 필터 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper p-3 no-print">
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={useDateFilter}
            onChange={(e) => setUseDateFilter(e.target.checked)}
          />
          날짜
        </label>
        <input
          type="date"
          value={date}
          disabled={!useDateFilter}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-40"
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·연락처·주소·주문번호 검색"
          className="min-w-[200px] flex-1 rounded-lg border border-line bg-cream px-3 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          <option value="전체">구분 전체</option>
          <option value="구독">구독</option>
          <option value="단품">단품</option>
        </select>
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value as typeof dayFilter)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          <option value="전체">요일 전체</option>
          {DELIVERY_DAYS.map((d) => (
            <option key={d} value={d}>
              {DELIVERY_DAY_LABEL[d]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          <option value="전체">상태 전체</option>
          {SHIPPABLE.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* 일괄 도구 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper p-3 no-print">
        <span className="text-[13px] text-ink-soft">택배사</span>
        <select
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          {COURIER_IDS.map((id) => (
            <option key={id} value={id}>
              {COURIERS[id].label}
            </option>
          ))}
        </select>
        <button
          onClick={bulkShip}
          disabled={busy || selected.size === 0}
          className="rounded-lg bg-ink px-3 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
        >
          선택 발송(배송중)
        </button>
        <button
          onClick={() => bulkStatus("배송준비")}
          disabled={busy || selected.size === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-30"
        >
          배송준비
        </button>
        <button
          onClick={() => bulkStatus("배송완료")}
          disabled={busy || selected.size === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-30"
        >
          배송완료
        </button>
      </div>

      {/* 현재 목록 제품별 합계 — 빠뜨림 방지용 한눈 요약 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-gold/8 px-4 py-2.5 text-[13px]">
        {BUCKET_LABEL.map((label, i) => (
          <span key={label} className="text-ink-soft">
            {label}{" "}
            <strong className="tabular-nums text-ink">{totals.q[i]}</strong>개
            <span className="ml-0.5 text-mute tabular-nums">({totals.liters[i]}L)</span>
          </span>
        ))}
        <span className="ml-auto font-semibold text-gold-deep">
          총 {totals.count}개 · {totals.litersTotal}L
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      {unmappedKeys.length > 0 && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
          ⚠️ 발송명단 4칸(우유180/750·요거트180/500)에 없는 제품 {unmappedKeys.length}종이
          수량·총합에서 빠집니다: {unmappedKeys.join(", ")}. 제품 분류를 확인하세요.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-mute">
              <th className="py-2.5 pr-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              {sortTh("name", "받는 분")}
              {sortTh("type", "구분·회차")}
              {sortTh("day", "요일")}
              <th className="py-2.5 px-1 text-center font-medium">우180</th>
              <th className="py-2.5 px-1 text-center font-medium">우750</th>
              <th className="py-2.5 px-1 text-center font-medium">요180</th>
              <th className="py-2.5 px-1 text-center font-medium">요500</th>
              {sortTh("count", "개수", "text-center")}
              {sortTh("region", "배송지")}
              {sortTh("status", "상태")}
              <th className="py-2.5 font-medium">송장번호</th>
              <th className="py-2.5 font-medium">출고</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-8 text-center text-[14px] text-mute">
                  배송 대상 주문이 없습니다.
                </td>
              </tr>
            ) : (
              queue.map((r) => {
                const o = r.o;
                const qcell = (n: number) =>
                  n ? (
                    <span className="font-semibold tabular-nums text-ink">{n}</span>
                  ) : (
                    <span className="text-line">·</span>
                  );
                return (
                  <tr key={o.id} className="border-b border-line/70 align-top">
                    <td className="py-3 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-ink">{o.ship_name}</p>
                      <p className="text-[12px] tabular-nums text-mute">{o.ship_phone}</p>
                      <p className="text-[11px] tabular-nums text-line">{o.order_no}</p>
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-ink-soft">
                      {o.order_type === "단품" ? "단품" : "구독"}
                      <span className="ml-1 rounded bg-gold/15 px-1.5 py-0.5 text-[11px] font-semibold text-gold-deep">
                        {o.order_type === "단품"
                          ? "1회"
                          : r.total > 0
                            ? `${r.round}/${r.total}회`
                            : `${r.round}회`}
                      </span>
                      {o.order_type !== "단품" && r.total > 0 && (
                        <span className="ml-1 text-[11px] text-mute">남은 {r.remaining}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-ink-soft">{r.dayLabel || "—"}</td>
                    <td className="py-3 px-1 text-center">{qcell(r.q[0])}</td>
                    <td className="py-3 px-1 text-center">{qcell(r.q[1])}</td>
                    <td className="py-3 px-1 text-center">{qcell(r.q[2])}</td>
                    <td className="py-3 px-1 text-center">{qcell(r.q[3])}</td>
                    <td className="py-3 pr-3 text-center text-[13px] tabular-nums text-ink">{r.count}</td>
                    <td className="py-3 pr-3 text-[12.5px] text-ink-soft">
                      {o.ship_postcode ? `(${o.ship_postcode}) ` : ""}
                      {o.ship_address}
                      {o.ship_address_detail ? ` ${o.ship_address_detail}` : ""}
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-gold-deep">{o.status}</td>
                    <td className="py-3">
                      <input
                        type="text"
                        value={trackingOf(o)}
                        onChange={(e) =>
                          setTracking((prev) => ({ ...prev, [o.id]: e.target.value }))
                        }
                        placeholder="송장번호"
                        className="w-36 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                      />
                    </td>
                    <td className="py-3">
                      {isShipped(r) ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                          출고됨
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => shipOut(r)}
                          disabled={shippingId === shipKey(r)}
                          className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1.5 text-[12.5px] font-semibold text-gold-deep transition-colors enabled:hover:bg-gold/20 disabled:opacity-40"
                        >
                          {shippingId === shipKey(r) ? "처리 중…" : "출고 확정"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {queue.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line text-[13px] font-semibold text-ink">
                <td className="py-2.5" />
                <td className="py-2.5 pr-3" colSpan={3}>
                  합계 {queue.length}건
                </td>
                <td className="py-2.5 px-1 text-center tabular-nums">{totals.q[0]}</td>
                <td className="py-2.5 px-1 text-center tabular-nums">{totals.q[1]}</td>
                <td className="py-2.5 px-1 text-center tabular-nums">{totals.q[2]}</td>
                <td className="py-2.5 px-1 text-center tabular-nums">{totals.q[3]}</td>
                <td className="py-2.5 pr-3 text-center tabular-nums">{totals.count}</td>
                <td className="py-2.5 pr-3 text-gold-deep" colSpan={4}>
                  총 {totals.litersTotal}L
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-4 text-[12.5px] text-mute">
        ※ 헤더를 누르면 정렬됩니다. ‘선택 발송’은 송장번호가 입력된 주문만 배송중으로 전환하고
        발송 알림을 보냅니다. 택배사는 선택분 전체에 동일 적용됩니다. 엑셀에는 회차별 발송일·유입·소득공발행 칸이 함께 출력됩니다.
      </p>
    </section>
  );
}
