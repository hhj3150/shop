"use client";

// 관리자: 배송 일괄처리 — 결제완료(입금확인 이후) 주문을 한 화면에서 모아
//   택배사·송장번호를 입력하고 상태를 일괄 전환한다.
//   단품은 발송예정일(ship_date), 구독은 요일(delivery_day)로 날짜 필터.
import { useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { PrintButton } from "@/components/PrintButton";
import { stockShipOut, recordShipmentTracking } from "@/lib/inventory-data";
import { notify } from "@/lib/notify";
import { COURIERS, COURIER_IDS, courierLabel } from "@/lib/couriers";
import { parseTrackingPaste, matchTracking } from "@/lib/tracking-paste";
import * as logenExcel from "@/lib/logen-excel";
import { matchLogen, type LogenMatchResult } from "@/lib/logen-match";
import { giftSenderLabel, giftSenderCsv } from "@/lib/gift";
import { DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";
import { dispatchScheduleForSlot } from "@/lib/dispatch-schedule";
import { buildTotalsRow } from "@/lib/dispatch-csv";
import { decideShipOut } from "@/lib/dispatch-shipout";
import { isCarriedOver, overdueDays } from "@/lib/dispatch-overdue";
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
  delivery_method: string | null; // '방문수령'이면 택배 발송 대상 아님 → 배송 큐에서 제외
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
  is_gift: boolean | null; // 선물이면 ship_* 는 받는 분
  gifter_name: string | null; // 보낸 분
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
  first_ship_date: string | null; // 첫배송 공휴일 보정일(없으면 1회차 = started_at)
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

// 엑셀이 숫자로 해석해 앞자리 0을 떼거나(우편번호·연락처) 지수표기로 깨뜨리는(송장번호)
//   값을 텍스트로 고정한다. ="…" 형태는 엑셀이 텍스트 그대로 표시한다. 빈 값은 빈칸 유지.
function excelText(v: string | null | undefined): string {
  const s = String(v ?? "");
  return s === "" ? "" : `="${s}"`;
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
  const queueRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(todayISO());
  const [useDateFilter, setUseDateFilter] = useState(true);
  const [courier, setCourier] = useState<string>("cj");
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 송장 일괄 붙여넣기(엑셀에서 주문번호+송장번호).
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // 로젠 엑셀 업로드(받는분·연락처7·운송장 → 주문 매칭).
  const [logenOpen, setLogenOpen] = useState(false);
  const [logenPreview, setLogenPreview] = useState<LogenMatchResult | null>(null);
  const [logenChecked, setLogenChecked] = useState<Record<number, string>>({}); // rowIdx → 선택 orderId
  const [logenNote, setLogenNote] = useState<string | null>(null);
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

  // 로젠 미리보기에서 orderId → 주문(주문번호·받는분 표시)을 빠르게 찾기 위한 맵.
  const orderById = useMemo(() => {
    const m = new Map<string, DispatchOrder>();
    for (const o of orders) m.set(o.id, o);
    return m;
  }, [orders]);

  // 4개 칸(우유180/750·요거트180/500)에 매핑되지 않는 제품 — 수량·총합·발송명단에서
  //   조용히 빠지므로 화면에 경고해 관리자가 분류 누락을 알아차리게 한다.
  const unmappedKeys = useMemo(() => {
    const its: { product_name: string; volume: string; qty: number }[] = [];
    for (const o of orders) {
      if (!SHIPPABLE.includes(o.status)) continue;
      if (o.delivery_method === "방문수령") continue; // 방문수령은 발송 대상 아님 → 수량 집계 제외
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
      // 방문수령: 손님이 목장에서 직접 받음 → 택배 발송 대상 아님(발송명단 roster 와 동일 제외).
      if (o.delivery_method === "방문수령") continue;
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
          // 당일분(ship_date == 선택일) + 지난 미출고분(이월)도 함께 — 그날 못 보내면 사라지는 걸 막는다.
          if (o.ship_date !== date && !isCarriedOver(o, date)) return false;
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

  // 행(회차) 단위 송장값. 운영자가 이번 화면에서 입력한 값이 최우선(빈칸으로 지운 것도 존중).
  //   저장된 o.tracking_no 는 '이 회차'가 실제 출고된 경우에만 노출한다 — 구독은 같은 주문 행을
  //   회차마다 재출고하므로, 아직 출고 안 한 다음 회차에 직전 회차 송장이 남아 보이면 운영자가
  //   그대로 재발송해 오배송이 된다(이전 송장 = 이전 배송 추적). 미출고 회차는 반드시 빈칸.
  function trackingOf(r: DispatchRow): string {
    const typed = tracking[r.o.id];
    if (typed != null) return typed;
    return isShipped(r) ? (r.o.tracking_no ?? "") : "";
  }

  // 붙여넣은 '주문번호+송장번호'를 파싱·매칭해 각 행 송장칸을 자동으로 채운다.
  //   매칭된 행은 자동 선택까지 해, 운영자가 바로 '선택 발송'으로 넘어갈 수 있다.
  function applyTrackingPaste() {
    const parsed = parseTrackingPaste(pasteText);
    const idByOrderNo = new Map(allRows.map((r) => [r.o.order_no, r.o.id]));
    const { matched, unmatched } = matchTracking(parsed, new Set(idByOrderNo.keys()));
    if (matched.length === 0) {
      setPasteNote(
        parsed.length === 0
          ? "인식된 행이 없습니다. '주문번호[탭]송장번호' 형식인지 확인하세요."
          : `매칭된 주문이 없습니다. 미매칭 ${unmatched.length}건.`
      );
      return;
    }
    setTracking((prev) => {
      const next = { ...prev };
      for (const m of matched) {
        const id = idByOrderNo.get(m.orderNo);
        if (id) next[id] = m.tracking;
      }
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of matched) {
        const id = idByOrderNo.get(m.orderNo);
        if (id) next.add(id);
      }
      return next;
    });
    const tail = unmatched.length
      ? ` · 미매칭 ${unmatched.length}건: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " 외" : ""}`
      : "";
    setPasteNote(`${matched.length}건 채움·선택됨${tail}`);
  }

  // 로젠 엑셀 파일을 읽어 운송장↔주문 매칭 미리보기를 만든다(xlsx 동적 import 로 메인 번들·SSR 제외).
  async function onLogenFile(file: File) {
    setLogenNote(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
      const parsed = logenExcel.parseLogenSheet(rows as string[][]);
      if (parsed.length === 0) {
        setLogenNote("로젠 엑셀에서 인식된 행이 없습니다(헤더/시트 확인).");
        setLogenPreview(null);
        return;
      }
      // 구독은 같은 주문 행을 회차마다 재출고하므로 o.tracking_no 엔 직전 회차 송장이 남는다.
      //   원본을 그대로 넘기면 이번 회차가 '이미채움'으로 잘못 분류돼 새 송장이 자동입력되지 않는다.
      //   → 회차 단위 유효 송장(미출고 회차는 빈값)으로 치환해 매칭한다.
      const res = matchLogen(
        parsed,
        allRows.map((r) => ({
          id: r.o.id,
          order_no: r.o.order_no,
          ship_name: r.o.ship_name,
          ship_phone: r.o.ship_phone,
          tracking_no: trackingOf(r) || null,
        }))
      );
      setLogenPreview(res);
      const init: Record<number, string> = {};
      for (const m of res.matched) if (m.confidence === "high") init[m.rowIdx] = m.orderId;
      setLogenChecked(init);
      setLogenNote(
        `매칭 ${res.matched.length} · 검토 ${res.matched.filter((m) => m.confidence === "review").length} · 모호 ${res.ambiguous.length} · 이미채움 ${res.alreadyFilled.length} · 미일치 ${res.unmatched.length}`
      );
    } catch (e) {
      console.error("로젠 엑셀 처리 실패:", e);
      setLogenPreview(null);
      setLogenNote("엑셀을 읽지 못했습니다. 로젠 주문실적조회 .xlsx 파일이 맞는지 확인하세요.");
    }
  }

  // 선택분(rowIdx→orderId)을 각 주문 송장칸에 채우고 자동 선택한다.
  //   한 주문에 두 행이 겹치면 덮어쓰기 사고를 막기 위해 멈춘다. 택배사도 로젠으로 맞춘다.
  function applyLogen() {
    const picks = Object.entries(logenChecked).filter(([, id]) => id); // [rowIdxStr, orderId]
    if (picks.length === 0) return;
    const perOrder = new Map<string, number>();
    for (const [, id] of picks) perOrder.set(id, (perOrder.get(id) ?? 0) + 1);
    const dup = [...perOrder].filter(([, n]) => n > 1).map(([id]) => id);
    if (dup.length > 0) {
      setLogenNote(`같은 주문에 송장이 2건 이상 선택됨(${dup.join(", ")}). 행을 1건씩만 선택하세요.`);
      return;
    }
    // 모호 행 후보엔 이미 송장이 있는 주문도 섞일 수 있다(lib 가 already-filled 보다 먼저 분류).
    //   기존 송장을 덮어쓰면 오발송이 되므로, 그런 선택이 있으면 전체 적용을 멈춘다.
    //   판정은 회차 단위 유효 송장(trackingOf)으로 한다 — 구독 다음 회차는 이전 회차 송장이
    //   주문에 남아 있어도 '아직 미채움'이어야 새 송장을 받을 수 있다.
    const rowById = new Map(allRows.map((r) => [r.o.id, r]));
    const filled = [...new Set(picks.map(([, id]) => id))].filter((id) => {
      const row = rowById.get(id);
      return row ? trackingOf(row).trim() !== "" : false;
    });
    if (filled.length > 0) {
      setLogenNote(`이미 송장이 있는 주문이 선택됨(${filled.join(", ")}). 해제 후 다시 시도하세요.`);
      return;
    }
    // 송장값이 실제로 잡힌 행만 채움·선택 대상으로 확정(빈 채움/무근거 선택 방지).
    const trackByRow = new Map((logenPreview?.matched ?? []).map((m) => [m.rowIdx, m.tracking]));
    const ambByRow = new Map((logenPreview?.ambiguous ?? []).map((a) => [a.rowIdx, a.tracking]));
    const resolved = picks
      .map(([idxStr, id]) => ({ id, t: trackByRow.get(Number(idxStr)) ?? ambByRow.get(Number(idxStr)) }))
      .filter((p): p is { id: string; t: string } => Boolean(p.t));
    if (courier !== "logen") setCourier("logen");
    setTracking((prev) => {
      const next = { ...prev };
      for (const { id, t } of resolved) next[id] = t;
      return next;
    });
    setSelected((prev) => {
      const next = new Set(prev);
      for (const { id } of resolved) next.add(id);
      return next;
    });
    setLogenNote(`${resolved.length}건 채움·선택됨. 상단에서 '선택 발송' 진행.`);
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

  // 출고·발송 → 그 발송일분 재고 차감(stock_ship_out, 주차당 1회·서버 보장) +
  //   송장·택배사·발송일 기록 + '배송중' 전환 + 발송 문자(새 전환 건만).
  //   재고 차감이 먼저라 주문 갱신이 실패해도 재시도 시 이중차감 없이 송장만 다시 반영된다.
  async function shipOut(r: DispatchRow) {
    const o = r.o;
    const decision = decideShipOut({
      status: o.status,
      shipped_at: o.shipped_at,
      courier,
      trackingNo: trackingOf(r),
      shipISO: r.shipISO,
      alreadyShipped: isShipped(r),
    });
    // 송장 없이 출고하면 발송 문자·배송추적이 누락되고 주문이 '입금확인'에 묶인다(되돌리기 번거로움).
    //   → 송장번호를 필수로 막는다. (출고 후 뒤늦게 넣을 땐 '출고됨' 행의 송장 저장 버튼 사용.)
    if (!decision.patch) {
      setError(`${o.ship_name}: 송장번호를 입력해야 출고·발송됩니다.`);
      return;
    }
    const k = shipKey(r);
    setShippingId(k);
    setError(null);
    try {
      await stockShipOut(o.id, r.shipISO);
      if (decision.patch) {
        const sb = getSupabase();
        const { error } = await sb.from("orders").update(decision.patch).eq("id", o.id);
        if (error) throw error;
        // 회차별 배송 레코드(shipment_log)에도 그 회차 송장을 기록 — 회차 이력·고객 추적의 권위값.
        await recordShipmentTracking(o.id, r.shipISO, decision.patch.courier, decision.patch.tracking_no);
        if (decision.notifyShipped) void notify({ kind: "shipped", orderId: o.id });
      }
      setJustShipped((prev) => new Set(prev).add(k));
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "출고 처리 실패");
    } finally {
      setShippingId(null);
    }
  }

  // 이미 출고된(재고 차감 완료) 행에 송장을 뒤늦게 저장 — 재고는 다시 빼지 않고 주문만 갱신한다.
  //   '출고는 됐는데 송장이 비어 입금확인에 묶인' 건을 그 자리에서 배송중으로 전환 + 발송 문자.
  async function saveTrackingShipped(r: DispatchRow) {
    const o = r.o;
    const decision = decideShipOut({
      status: o.status,
      shipped_at: o.shipped_at,
      courier,
      trackingNo: trackingOf(r),
      shipISO: r.shipISO,
      alreadyShipped: isShipped(r),
    });
    if (!decision.patch) {
      setError(`${o.ship_name}: 송장번호를 입력해 주세요.`);
      return;
    }
    const k = shipKey(r);
    setShippingId(k);
    setError(null);
    try {
      const sb = getSupabase();
      const { error } = await sb.from("orders").update(decision.patch).eq("id", o.id);
      if (error) throw error;
      await recordShipmentTracking(o.id, r.shipISO, decision.patch.courier, decision.patch.tracking_no);
      if (decision.notifyShipped) void notify({ kind: "shipped", orderId: o.id });
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "송장 저장 실패");
    } finally {
      setShippingId(null);
    }
  }

  // 배송 담당자용 발송 명단 엑셀 — 회차별 발송일 칸 + 제품 수량 + 총개수/총 L량 합계(빠뜨림 방지).
  function exportDispatchCsv() {
    const header = [
      "유입", "이름", "보낸이(선물)", "연락처", "우편번호", "주소", "상세주소", "최근주문",
      "구분", "배송요일", "회차", "남은회차", "발송일",
      ...BUCKET_LABEL, "택배사", "송장번호", "소득공발행", "상태",
    ];
    const rows: string[][] = [header];
    for (const r of queue) {
      const o = r.o;
      const courierName = courierLabel(o.courier);
      const isOnce = o.order_type === "단품";
      // 회차/총회차 — 연장(8·12주) 구독도 5회차+ 가 정확히 출력된다.
      //   "회"를 붙여 화면 표기와 맞추고, 엑셀이 "2/8"을 날짜로 자동변환하는 것도 막는다.
      const roundCell = isOnce ? "단품" : r.total > 0 ? `${r.round}/${r.total}회` : `${r.round}회`;
      const remainCell = !isOnce && r.total > 0 ? String(r.remaining) : "";
      rows.push([
        "", // 유입경로 — 현재 미수집(담당자 기입용)
        o.ship_name,
        giftSenderCsv(o.is_gift, o.gifter_name),
        excelText(o.ship_phone),
        excelText(o.ship_postcode),
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
        excelText(trackingOf(r)),
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
    const targets = queue.filter((r) => selected.has(r.o.id) && trackingOf(r).trim());
    if (targets.length === 0) {
      setError("송장번호가 입력된 선택 주문이 없습니다.");
      return;
    }
    // 실수 방지: 일괄 발송은 고객에게 문자가 나가므로 건수를 확인받는다.
    if (!window.confirm(`${targets.length}건을 '배송중'으로 처리하고 발송 문자를 보냅니다. 계속할까요?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      // 행 출고와 완전히 동일하게: 재고차감(stock_ship_out, 회차당 1회·서버 멱등) +
      //   주문 갱신 + 회차 송장 기록(shipment_log)까지 일괄로 수행한다. 선택 발송도 '출고'로
      //   보고 재고·회차 이력을 정확히 남겨, 행 출고와 결과가 갈리지 않게 한다.
      const results = await Promise.all(
        targets.map(async (r) => {
          const o = r.o;
          const decision = decideShipOut({
            status: o.status,
            shipped_at: o.shipped_at,
            courier,
            trackingNo: trackingOf(r),
            shipISO: r.shipISO,
            alreadyShipped: isShipped(r),
          });
          try {
            await stockShipOut(o.id, r.shipISO); // 이미 출고된 회차면 서버가 'already' → 이중차감 없음
            if (decision.patch) {
              const { error } = await sb.from("orders").update(decision.patch).eq("id", o.id);
              if (error) throw error;
              await recordShipmentTracking(o.id, r.shipISO, decision.patch.courier, decision.patch.tracking_no);
            }
            return { o, decision, error: null as { message?: string } | null };
          } catch (e) {
            return { o, decision, error: { message: e instanceof Error ? e.message : "처리 실패" } };
          }
        })
      );
      // 업데이트 성공 + 새로 '배송중'으로 전환된 건에만 발송 문자를 보낸다.
      //   (조용한 실패 시 오발송 방지 / 이미 배송중인 건 중복 발송 방지)
      for (const { o, decision, error } of results) {
        if (!error && decision.notifyShipped) void notify({ kind: "shipped", orderId: o.id });
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
    // 실수 방지: 일괄 상태 변경 건수를 확인받는다.
    if (!window.confirm(`선택 ${targets.length}건을 '${status}'(으)로 변경할까요?`)) {
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
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="ml-auto rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
        >
          송장 일괄 붙여넣기 {pasteOpen ? "▴" : "▾"}
        </button>
        <button
          onClick={() => setLogenOpen((v) => !v)}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
        >
          로젠 엑셀 업로드 {logenOpen ? "▴" : "▾"}
        </button>
      </div>

      {/* 송장 일괄 붙여넣기 — 엑셀 '주문번호+송장번호'를 붙여 각 행 송장칸을 한 번에 채운다 */}
      {pasteOpen && (
        <div className="mt-2 rounded-2xl border border-line bg-paper p-3 no-print">
          <p className="text-[13px] text-ink-soft">
            엑셀에서 <strong>주문번호 + 송장번호</strong> 두 열을 복사해 붙여넣고 [송장 채우기]를
            누르세요. 택배사는 위에서 선택한 값으로 발송됩니다.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
              setPasteNote(null);
            }}
            rows={4}
            placeholder={"SY-1001\t123456789012\nSY-1002\t987654321098"}
            className="mt-2 w-full resize-y rounded-xl border border-line bg-cream px-3 py-2 font-mono text-[13px] text-ink placeholder:text-mute focus:border-gold focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-3">
            <button
              onClick={applyTrackingPaste}
              disabled={!pasteText.trim()}
              className="rounded-lg bg-ink px-3 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
            >
              송장 채우기
            </button>
            {pasteNote && <span className="text-[13px] text-ink-soft">{pasteNote}</span>}
          </div>
        </div>
      )}

      {/* 로젠 엑셀 업로드 — 운송장 등록 엑셀을 올려 받는분·연락처·운송장으로 주문을 매칭해 송장칸을 채운다 */}
      {logenOpen && (
        <div className="mt-2 rounded-2xl border border-line bg-paper p-3 no-print">
          <p className="text-[13px] text-ink-soft">
            로젠에서 받은 <strong>운송장 등록 엑셀</strong>(받는분·연락처·운송장번호)을 올리면 주문과
            자동 매칭됩니다. 선택한 행만 송장칸이 채워지고 택배사는 <strong>로젠</strong>으로 맞춰집니다.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogenFile(f);
              e.target.value = "";
            }}
            className="mt-2 block w-full text-[13px] text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-cream file:px-3 file:py-1.5 file:text-[13px] file:text-ink-soft"
          />

          {logenPreview && (
            <div className="mt-3 overflow-x-auto">
              <table className="admin-cards-sm w-full md:min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-mute">
                    <th className="py-2 pr-3 font-medium">선택</th>
                    <th className="py-2 pr-3 font-medium">로젠(받는분·연락처·운송장)</th>
                    <th className="py-2 pr-3 font-medium">매칭 주문</th>
                    <th className="py-2 pr-3 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {logenPreview.matched.map((m) => {
                    const o = orderById.get(m.orderId);
                    const checked = logenChecked[m.rowIdx] === m.orderId;
                    return (
                      <tr key={`m-${m.rowIdx}`} className="border-b border-line/70 align-top">
                        <td data-label="선택" className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setLogenChecked((prev) => {
                                const n = { ...prev };
                                if (n[m.rowIdx]) delete n[m.rowIdx];
                                else n[m.rowIdx] = m.orderId;
                                return n;
                              })
                            }
                          />
                        </td>
                        <td data-label="로젠" className="py-2 pr-3 tabular-nums text-ink">{m.tracking}</td>
                        <td data-label="매칭 주문" className="py-2 pr-3 text-ink-soft">
                          {o ? `${o.order_no} · ${o.ship_name}` : m.orderId}
                        </td>
                        <td data-label="상태" className="py-2 pr-3">
                          {m.confidence === "high" ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                              매칭
                            </span>
                          ) : (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                              검토
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {logenPreview.ambiguous.map((a) => (
                    <tr key={`a-${a.rowIdx}`} className="border-b border-line/70 align-top">
                      <td data-label="선택" className="py-2 pr-3">
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                          모호
                        </span>
                      </td>
                      <td data-label="로젠" className="py-2 pr-3 tabular-nums text-ink">{a.tracking}</td>
                      <td className="py-2 pr-3" colSpan={2}>
                        <select
                          value={logenChecked[a.rowIdx] ?? ""}
                          onChange={(e) =>
                            setLogenChecked((prev) => {
                              const n = { ...prev };
                              if (e.target.value) n[a.rowIdx] = e.target.value;
                              else delete n[a.rowIdx];
                              return n;
                            })
                          }
                          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
                        >
                          <option value="">선택 안 함</option>
                          {a.candidateOrderIds.map((id) => {
                            const o = orderById.get(id);
                            return (
                              <option key={id} value={id}>
                                {o ? `${o.order_no} · ${o.ship_name}` : id}
                              </option>
                            );
                          })}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {logenPreview.alreadyFilled.map((f) => {
                    const o = orderById.get(f.orderId);
                    return (
                      <tr key={`f-${f.rowIdx}`} className="border-b border-line/70 align-top text-mute">
                        <td data-label="선택" className="py-2 pr-3">—</td>
                        <td data-label="로젠" className="py-2 pr-3 tabular-nums">{f.tracking}</td>
                        <td data-label="매칭 주문" className="py-2 pr-3">{o ? `${o.order_no} · ${o.ship_name}` : f.orderId}</td>
                        <td data-label="상태" className="py-2 pr-3">이미 송장 있음</td>
                      </tr>
                    );
                  })}
                  {logenPreview.unmatched.map((u) => (
                    <tr key={`u-${u.rowIdx}`} className="border-b border-line/70 align-top text-mute">
                      <td data-label="선택" className="py-2 pr-3">—</td>
                      <td data-label="로젠" className="py-2 pr-3 tabular-nums">
                        {u.recipientName} · {u.phone7} · {u.tracking}
                      </td>
                      <td className="py-2 pr-3" colSpan={2}>
                        미일치 (필터로 가려졌을 수 있음)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={applyLogen}
              disabled={!logenPreview}
              className="rounded-lg bg-ink px-3 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
            >
              선택분 송장 채우기
            </button>
            {logenNote && <span className="text-[13px] text-ink-soft">{logenNote}</span>}
          </div>
        </div>
      )}

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

      <div className="no-print mb-2 flex justify-end">
        <PrintButton targetRef={queueRef} />
      </div>

      <div ref={queueRef} className="mt-4 overflow-x-auto">
        <div className="print-only mb-3 text-[15px] font-semibold text-ink">
          배송 리스트 · {new Date().toLocaleDateString("ko-KR")}
        </div>
        <table className="admin-cards-sm w-full md:min-w-[1080px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-mute">
              <th className="no-print py-2.5 pr-3">
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
              <th className="no-print py-2.5 font-medium">출고</th>
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
                    <td data-label="선택" className="no-print py-3 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
                    <td data-label="받는 분" className="py-3 pr-3">
                      <p className="text-ink">{o.ship_name}</p>
                      {giftSenderLabel(o.is_gift, o.gifter_name) && (
                        <p className="text-[12px] font-medium text-gold-deep">
                          🎁 {giftSenderLabel(o.is_gift, o.gifter_name)}
                        </p>
                      )}
                      <p className="text-[12px] tabular-nums text-mute">{o.ship_phone}</p>
                      <p className="text-[11px] tabular-nums text-line">{o.order_no}</p>
                    </td>
                    <td data-label="구분·회차" className="py-3 pr-3 text-[13px] text-ink-soft">
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
                      {isCarriedOver(o, date) && (
                        <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                          지연 {overdueDays(o.ship_date, date)}일
                        </span>
                      )}
                    </td>
                    <td data-label="요일" className="py-3 pr-3 text-[13px] text-ink-soft">{r.dayLabel || "—"}</td>
                    <td data-label="우180" className="py-3 px-1 text-center">{qcell(r.q[0])}</td>
                    <td data-label="우750" className="py-3 px-1 text-center">{qcell(r.q[1])}</td>
                    <td data-label="요180" className="py-3 px-1 text-center">{qcell(r.q[2])}</td>
                    <td data-label="요500" className="py-3 px-1 text-center">{qcell(r.q[3])}</td>
                    <td data-label="개수" className="py-3 pr-3 text-center text-[13px] tabular-nums text-ink">{r.count}</td>
                    <td data-label="배송지" className="py-3 pr-3 text-[12.5px] text-ink-soft">
                      {o.ship_postcode ? `(${o.ship_postcode}) ` : ""}
                      {o.ship_address}
                      {o.ship_address_detail ? ` ${o.ship_address_detail}` : ""}
                    </td>
                    <td data-label="상태" className="py-3 pr-3 text-[13px] text-gold-deep">{o.status}</td>
                    <td data-label="송장번호" className="py-3">
                      <input
                        type="text"
                        value={trackingOf(r)}
                        onChange={(e) =>
                          setTracking((prev) => ({ ...prev, [o.id]: e.target.value }))
                        }
                        placeholder="송장번호"
                        className="no-print w-36 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                      />
                      <span className="print-only tabular-nums">{trackingOf(r)}</span>
                    </td>
                    <td data-label="출고" className="no-print py-3">
                      {isShipped(r) ? (
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-semibold text-emerald-700">
                            출고됨
                          </span>
                          {o.status !== "배송중" && (
                            // 출고는 됐으나 송장 없어 입금확인에 묶인 건 — 여기서 송장 넣고 배송중 전환·문자.
                            <button
                              type="button"
                              onClick={() => saveTrackingShipped(r)}
                              disabled={shippingId === shipKey(r)}
                              className="rounded-full border border-gold/50 bg-gold/10 px-2.5 py-1 text-[12px] font-semibold text-gold-deep transition-colors enabled:hover:bg-gold/20 disabled:opacity-40"
                            >
                              {shippingId === shipKey(r) ? "처리 중…" : "송장 저장"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => shipOut(r)}
                          disabled={shippingId === shipKey(r)}
                          className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1.5 text-[12.5px] font-semibold text-gold-deep transition-colors enabled:hover:bg-gold/20 disabled:opacity-40"
                        >
                          {shippingId === shipKey(r) ? "처리 중…" : "출고·발송"}
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
