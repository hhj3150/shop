"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";
import { computeSchedule } from "@/lib/subscription-schedule";
import { buildRosterForDate, type DeliveryEntry as RosterEntry } from "@/lib/delivery-roster";
import { buildRawBlocks, type OrderRow as BlockOrderRow, type OrderItemRow as BlockItemRow } from "@/lib/slot-blocks";
import type { RawBlock } from "@/lib/subscription-timeline";
import { computeCashReceiptAmounts } from "@/lib/cash-receipt-tax";
import {
  DELIVERY_DAYS,
  DELIVERY_DAY_LABEL,
  type DeliveryDay,
} from "@/lib/cart";
import { firstSubscriptionDelivery, firstDeliveryOnOrAfter, toISODate } from "@/lib/ship-date";
import { COURIERS, COURIER_IDS } from "@/lib/couriers";
import { notify } from "@/lib/notify";
import { usePolling } from "@/lib/usePolling";
import { PayActionReRegister, postPayActionRegister } from "@/components/PayActionReRegister";
import { AdminAssistant } from "@/components/AdminAssistant";
import { ReferralAdminPanel } from "@/components/ReferralAdminPanel";
import { FunnelDashboard } from "@/components/FunnelDashboard";
import { payActionReasonLabel } from "@/lib/payaction-reason";
import { AdminStats } from "@/components/AdminStats";
import { BroadcastPanel } from "@/components/BroadcastPanel";
import { ProductionPanel } from "@/components/ProductionPanel";
import { WeeklyPlanTable } from "@/components/WeeklyPlanTable";
import { Customer360Drawer } from "@/components/Customer360Drawer";
import { AdminGlobalSearch } from "@/components/AdminGlobalSearch";
import { AdminTodayBoard, type TodoCard } from "@/components/AdminTodayBoard";
import { buildCustomer360, type C360OrderEvent, type C360Sms } from "@/lib/customer-360";
import { buildMemberSmsPayload } from "@/lib/member-sms";
import { giftSenderLabel, giftSenderCsv } from "@/lib/gift";
import { ProfileEditor, type ProfileEditValues } from "@/components/ProfileEditor";
import { ProductAdminPanel } from "@/components/ProductAdminPanel";
import { InventoryPanel } from "@/components/InventoryPanel";
import { DispatchPanel } from "@/components/DispatchPanel";
import { loadShippedKeys } from "@/lib/inventory-data";
import { ReturnsPanel } from "@/components/ReturnsPanel";
import { loadReturns, type OrderReturn } from "@/lib/returns";
import { splitDemandByKind, buildWeeklyMatrix } from "@/lib/production-demand";
import { duplicateIds, normalizePhone } from "@/lib/duplicates";
import { SettlementPanel } from "@/components/SettlementPanel";

// 역할 탭 — 단일 관리자 계정 안에서 업무별 작업화면을 나눈다.
const TABS = ["종합 관리", "주문·입금", "회원·구독", "생산·재고", "상품·재고", "배송", "환불·교환", "정산·세금"] as const;
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

// ISO 날짜(YYYY-MM-DD) → 배송 요일키(주말은 null). 배송 명단·생산 수요 계산 공용.
function weekdayOf(iso: string): DeliveryDay | null {
  const [y, mo, da] = iso.split("-").map(Number);
  return y ? JS_DAY_TO_KEY[new Date(y, mo - 1, da).getDay()] : null;
}

// PostgREST 기본 행 상한(보통 1000)을 넘겨 전부 가져온다(.range 페이지네이션).
//   행 수가 상한 미만이면 요청 1회로 끝나, 데이터가 적을 땐 기존과 동일하게 동작한다.
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    const rows = (data as T[] | null) ?? [];
    if (error || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type OrderRow = {
  id: string;
  user_id: string;
  order_no: string;
  status: string;
  order_type: string; // '구독' | '단품'
  block_weeks: number | null; // 구독 1회 결제분 회차(연장 전 원 회차)
  shipping_fee: number | null; // 주문 총 배송비(회당 = shipping_fee / block_weeks)
  ship_date: string | null; // 단품 발송 예정일 (YYYY-MM-DD)
  total_amount: number;
  depositor_name: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  memo: string | null;
  is_gift: boolean | null; // 선물 주문이면 ship_* 는 받는 분, gifter_name 은 보낸 분
  gifter_name: string | null; // 보낸 분(주문자) 표시명
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  renews_slot_id: number | null; // 연장 주문이면 잇는 슬롯 id, 아니면 null
  cash_receipt_type: string | null; // 소득공제 | 지출증빙 | 발행안함
  cash_receipt_id: string | null; // 소득공제: 휴대폰, 지출증빙: 사업자번호
  cash_receipt_issued: boolean | null; // 관리자 수기 발행 완료 여부
  paid_at: string | null; // 입금/결제 확인 시각 (수동·자동 공통)
  pay_method: string | null; // 무통장 | 카드 등
  created_at: string;
};

type ItemRow = {
  id: string;
  order_id: string;
  product_id: string;
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
  first_ship_date: string | null; // 첫배송 공휴일 보정일(없으면 1회차 = started_at)
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null; // 연장 누적 회차(총 회차 = 원주문 block_weeks + extended_weeks)
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

// 고객 등급(세그먼트) — 구독여부 + 최근 주문 경과일로 분류.
type MemberSegment = "구독중" | "활성" | "주의" | "휴면" | "신규";
const SEGMENTS: readonly MemberSegment[] = ["구독중", "활성", "주의", "휴면", "신규"];
const SEGMENT_TONE: Record<MemberSegment, string> = {
  구독중: "bg-gold/15 text-gold-deep",
  활성: "bg-emerald-100 text-emerald-700",
  주의: "bg-amber-100 text-amber-700",
  휴면: "bg-ink/10 text-mute",
  신규: "bg-sky-100 text-sky-700",
};

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 구성품(제품·용량·수량)을 정렬해 만든 표준 문자열. 같은 구성이면 같은 값이 나와 포장 묶음을 만든다.
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
  // 순매출 차감용 환불·교환 원장. ReturnsPanel 도 자체 로딩하나, 통계의 순매출
  //   계산엔 페이지 레벨에서 한 번 더 필요하다(설계: 중복 fetch 1회 허용).
  const [returns, setReturns] = useState<OrderReturn[]>([]);
  // 이미 출고된 (주문|발송일) 키 — 배송 행 [출고 확정] 비활성용(이중차감 방지).
  const [shippedKeys, setShippedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [tab, setTab] = useState<AdminTab>("종합 관리");
  const [memberQuery, setMemberQuery] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("전체");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  // 배송지(주문 스냅샷) 정정 폼이 열린 주문 id. 펼침과 독립적으로 토글한다.
  const [editingShipOrder, setEditingShipOrder] = useState<string | null>(null);
  // 구독 시작일 연기 폼이 열린 주문 id + 입력된 기준일.
  const [startDeferOrder, setStartDeferOrder] = useState<string | null>(null);
  const [startDeferDate, setStartDeferDate] = useState<string>("");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  // 기간별 배송 명단은 길어서 기본 접힘 — 포장/명단 확인이 필요할 때만 펼친다.
  const [showRoster, setShowRoster] = useState(false);
  // 마운트 시점 기준 '지금' — 회원 최근주문 경과일(recencyDays) 계산용.
  //   렌더 중 Date.now() 직접 호출(비순수)을 피하려 1회만 고정한다.
  const [now] = useState(() => Date.now());
  // 종합 탭의 이상감지 링크 → '주문·입금' 탭으로 전환한 뒤 해당 주문으로 스크롤하기 위한 대기 플래그.
  //   (#order-manage 앵커는 주문·입금 탭에서만 렌더되므로, 탭 전환·마운트 후에 스크롤해야 한다.)
  const [pendingOrderScroll, setPendingOrderScroll] = useState(false);
  // 클레임 복기 타임라인: 선택 고객의 상태전이·문자발송 이력(온디맨드 조회, best-effort).
  const [traceEvents, setTraceEvents] = useState<C360OrderEvent[]>([]);
  const [traceSms, setTraceSms] = useState<C360Sms[]>([]);
  // CS 메모(관리자 내부 기록). 선택 고객 열 때 온디맨드 조회, best-effort.
  const [memberMemo, setMemberMemo] = useState<string>("");

  const isAdmin = Boolean(profile?.is_admin);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/admin");
  }, [ready, user, router]);

  // 탭이 '주문·입금'으로 바뀌고 대기 플래그가 서 있으면, 마운트된 #order-manage 로 스크롤한다.
  useEffect(() => {
    if (tab === "주문·입금" && pendingOrderScroll) {
      document.getElementById("order-manage")?.scrollIntoView({ behavior: "smooth" });
      setPendingOrderScroll(false);
    }
  }, [tab, pendingOrderScroll]);

  // 360 드로어가 열린 고객의 복기 타임라인 원자료(상태전이·문자) 온디맨드 조회.
  //   테이블 미적용(prod)·오류 시 빈 배열로 폴백 — 드로어는 그대로 동작한다.
  useEffect(() => {
    if (!selectedMember) {
      setTraceEvents([]);
      setTraceSms([]);
      setMemberMemo("");
      return;
    }
    const ids = orders.filter((o) => o.user_id === selectedMember).map((o) => o.id);
    let cancelled = false;
    (async () => {
      const sb = getSupabase();

      const note = await sb
        .from("member_admin_notes")
        .select("memo")
        .eq("user_id", selectedMember)
        .maybeSingle();
      if (!cancelled) setMemberMemo((note.data?.memo as string | undefined) ?? "");

      const ev = ids.length
        ? await sb
            .from("order_events")
            .select("order_id, event, from_status, to_status, reason, created_at")
            .in("order_id", ids)
        : { data: [] as C360OrderEvent[] };
      if (!cancelled) setTraceEvents((ev.data ?? []) as C360OrderEvent[]);

      const smsQuery = sb.from("sms_log").select("user_id, order_id, kind, ok, sent_at");
      const sms = ids.length
        ? await smsQuery.or(`user_id.eq.${selectedMember},order_id.in.(${ids.join(",")})`)
        : await smsQuery.eq("user_id", selectedMember);
      if (!cancelled) setTraceSms((sms.data ?? []) as C360Sms[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMember, orders]);

  // 이상감지 등에서 특정 주문을 '주문·입금' 탭에서 검색·표시한다.
  function focusOrderInManageTab(orderNo: string) {
    setOrderQuery(orderNo);
    setTab("주문·입금");
    setPendingOrderScroll(true);
  }

  // 전역 검색 입력 데이터(회원·주문). 검색 컴포넌트가 쓰는 최소 형태로 투영한다.
  const searchMembers = useMemo(
    () => profiles.map((p) => ({ id: p.id, name: p.name, phone: p.phone, address: p.address })),
    [profiles]
  );

  // silent=true 면 전체 로딩 표시를 띄우지 않는다 — 30초 자동 새로고침이
  //   매번 화면을 '불러오는 중…'으로 깜빡이지 않게 하기 위함.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const sb = getSupabase();
    const [o, i, s, p, shipped, r] = await Promise.all([
      // ★ .range() 페이지네이션은 '전순서(total order)'가 있어야 안전하다. 정렬 기준이
      //   없거나 동순위가 있으면 페이지 경계에서 행이 누락·중복되어, 1000행을 넘는 순간
      //   배송 명단에서 몇 건씩 빠진다. 모든 쿼리에 고유키(id) 정렬을 붙여 안정화한다.
      fetchAll<OrderRow>((from, to) =>
        sb
          .from("orders")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAll<ItemRow>((from, to) =>
        sb.from("order_items").select("*").order("id", { ascending: true }).range(from, to)
      ),
      fetchAll<SlotRow>((from, to) =>
        sb.from("subscription_slots").select("*").order("id", { ascending: true }).range(from, to)
      ),
      fetchAll<ProfileRow>((from, to) =>
        sb
          .from("profiles")
          .select("id, name, phone, marketing_consent, postcode, address, address_detail, created_at")
          .order("id", { ascending: true })
          .range(from, to)
      ),
      loadShippedKeys().catch(() => new Set<string>()),
      loadReturns().catch(() => [] as OrderReturn[]),
    ]);
    setOrders(o);
    setItems(i);
    setSlots(s);
    setProfiles(p);
    setShippedKeys(shipped);
    setReturns(r);
    setLastRefreshed(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // 30초마다 조용히 자동 새로고침 — PayAction 무통장입금 자동확인(입금대기→입금확인)이
  //   관리자 화면에 자동으로 반영돼, 새로고침 없이 배송준비로 진행할 수 있다.
  const refreshSilently = useCallback(() => load({ silent: true }), [load]);
  usePolling(refreshSilently, 30_000, isAdmin);

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
  // 주문 → 구독 슬롯(회차·제외 판정용). 연장은 원주문을 가리키므로 order_id 로 매핑.
  //   배송 명단에서 해지·회차소진 구독을 제외하기 위해 dispatchScheduleForSlot 에 넘긴다.
  const slotByOrder = useMemo(() => {
    const m = new Map<string, SlotRow>();
    for (const s of slots) if (s.order_id) m.set(s.order_id, s);
    return m;
  }, [slots]);
  // 주문별 품목 묶음 — 주문 드릴다운(주문 관리 표 펼치기)·회원 주문 모달에서 공용으로 쓴다.
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const it of items) {
      const arr = m.get(it.order_id) ?? [];
      arr.push(it);
      m.set(it.order_id, arr);
    }
    return m;
  }, [items]);

  // ── 블록(연장 체인) 인지 데이터 ─────────────────────────────
  //   슬롯 한 건이 원주문(block0) + 연장주문(block k) 체인을 갖는다. 연장주문은 자기
  //   order_items 를 가질 수 있어, 한 슬롯의 여러 블록이 같은 날 동시에 발송되면 이중발송이
  //   된다. 발송일별 '활성 블록' 1개만 발송/집계하기 위해 아래 맵들을 조립한다.
  const slotById = useMemo(() => {
    const m = new Map<number, SlotRow>();
    for (const s of slots) m.set(s.id, s);
    return m;
  }, [slots]);

  // 연장주문(renews_slot_id != null) 중 확정류(CONFIRMED) 상태만 슬롯별로 묶고 created_at,id 순 정렬.
  //   취소·입금대기 연장주문은 블록으로 치지 않는다(확정된 회차만 발송 대상).
  const renewalOrdersBySlot = useMemo(() => {
    const m = new Map<number, OrderRow[]>();
    for (const o of orders) {
      if (o.renews_slot_id == null) continue;
      if (!CONFIRMED.includes(o.status as (typeof CONFIRMED)[number])) continue;
      const arr = m.get(o.renews_slot_id) ?? [];
      arr.push(o);
      m.set(o.renews_slot_id, arr);
    }
    for (const [k, arr] of m) {
      m.set(
        k,
        [...arr].sort(
          (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
        )
      );
    }
    return m;
  }, [orders]);

  // OrderRow → buildRawBlocks 입력으로 변환(필요 필드만, 안전한 기본값).
  const toBlockOrder = useCallback(
    (o: OrderRow): BlockOrderRow => ({
      id: o.id,
      block_weeks: o.block_weeks ?? 0,
      shipping_fee: o.shipping_fee ?? 0,
      created_at: o.created_at,
    }),
    []
  );

  // 주문 id → order_items(블록 빌더용 최소 필드). 원주문·연장주문 모두 포함.
  const blockItemsByOrder = useMemo(() => {
    const m = new Map<string, BlockItemRow[]>();
    for (const [oid, rows] of itemsByOrder) {
      m.set(
        oid,
        rows.map((it) => ({
          delivery_day: it.delivery_day,
          qty: it.qty,
          unit_price: it.unit_price,
          product_name: it.product_name,
          volume: it.volume,
        }))
      );
    }
    return m;
  }, [itemsByOrder]);

  // 슬롯 id → 블록 체인(RawBlock[]). 원주문은 slot.order_id 주문, 연장은 renewalOrdersBySlot.
  const blocksBySlot = useMemo(() => {
    const m = new Map<number, RawBlock[]>();
    for (const s of slots) {
      if (!s.order_id) continue;
      const original = orderById.get(s.order_id);
      if (!original) continue;
      const renewals = (renewalOrdersBySlot.get(s.id) ?? []).map(toBlockOrder);
      m.set(s.id, buildRawBlocks(toBlockOrder(original), renewals, blockItemsByOrder));
    }
    return m;
  }, [slots, orderById, renewalOrdersBySlot, blockItemsByOrder, toBlockOrder]);

  // 주문 id(원주문 + 연장주문 모두) → 슬롯 id. 활성 블록 조회 키.
  const slotIdByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of slots) if (s.order_id) m.set(s.order_id, s.id);
    for (const [slotId, arr] of renewalOrdersBySlot) {
      for (const o of arr) m.set(o.id, slotId);
    }
    return m;
  }, [slots, renewalOrdersBySlot]);

  // ── 데이터 점검 — 배포 중 접속 등으로 생길 수 있는 데이터 이상을 한눈에 잡는다.
  //   (1) 입금확인 이후 상태인데 결제확인 시각(paid_at)이 없는 주문 → 실입금 없이 확인됐을 가능성.
  //   (2) 담긴 품목이 0건인 주문(취소 제외) → 주문상품이 안 보이는 이상.
  const anomalies = useMemo(() => {
    const paymentNoEvidence = orders.filter(
      (o) => CONFIRMED.includes(o.status as (typeof CONFIRMED)[number]) && !o.paid_at
    );
    const emptyItems = orders.filter(
      (o) => o.status !== "취소" && (itemsByOrder.get(o.id)?.length ?? 0) === 0
    );
    return { paymentNoEvidence, emptyItems };
  }, [orders, itemsByOrder]);
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
  // 입금확인 완료됐으나 아직 배송준비로 넘기지 않은 주문 수 — 관리자가 처리할 대기 작업량.
  const depositPendingCount = useMemo(
    () => orders.filter((o) => o.status === "입금확인").length,
    [orders]
  );
  // PayAction 미등록(입금대기) 주문 — 자동매칭 감시에 올라가지 않아 입금확인이 안 되는 주문들.
  //   관리자가 '일괄 재등록'으로 한 번에 PayAction 등록을 재시도한다.
  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === "입금대기"),
    [orders]
  );

  // 주문 관리 표 전용 필터(이름·입금자·주문번호·연락처 검색 + 상태). 전역 orders 는 그대로 둔다.
  const managedOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderStatusFilter !== "전체" && o.status !== orderStatusFilter) return false;
      if (!q) return true;
      const hay = [o.order_no, o.depositor_name ?? "", o.ship_name ?? "", o.ship_phone ?? ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, orderQuery, orderStatusFilter]);

  // 입금대기 주문을 순차로 PayAction 재등록하고 성공/실패 건수를 요약한다.
  //   순차 호출로 PayAction 서버 부하·레이트리밋을 피하고, 끝나면 한 번만 새로고침한다.
  const batchReRegister = useCallback(async () => {
    if (batchRunning || pendingOrders.length === 0) return;
    setBatchRunning(true);
    setBatchSummary(null);
    let ok = 0;
    const fails: string[] = [];
    for (const o of pendingOrders) {
      const r = await postPayActionRegister(o.order_no);
      if (r.ok) ok += 1;
      else fails.push(payActionReasonLabel(r.reason));
    }
    await load();
    setBatchRunning(false);
    const failNote =
      fails.length > 0 ? ` · 실패 ${fails.length}건 (${Array.from(new Set(fails)).join(", ")})` : "";
    setBatchSummary(`재등록 완료 — 성공 ${ok}건${failNote}`);
  }, [batchRunning, pendingOrders, load]);

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

  // 이번 주(월~금) 각 요일의 실제 날짜 — 활성 블록 판정 기준(roster 와 동일 SSOT).
  //   렌더 순수성을 위해 새 new Date() 대신 고정된 now(Date.now() 스냅샷)에서 파생한다.
  const thisWeekDates = useMemo<Record<DeliveryDay, string>>(() => {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    const dow = (base.getDay() + 6) % 7; // 월=0
    base.setDate(base.getDate() - dow);
    const out = {} as Record<DeliveryDay, string>;
    DELIVERY_DAYS.forEach((d, i) => {
      const dt = new Date(base);
      dt.setDate(base.getDate() + i);
      out[d] = toISODate(dt);
    });
    return out;
  }, [now]);

  // 요일별·제품별 주간 필요수량 — 슬롯의 활성 블록 1개만 그 요일에 계상(연장 이중계상 방지).
  //   단품은 슬롯이 없어 blocksBySlot 에 들어오지 않으므로 자연히 제외된다(단품 제외 가드 유지).
  const matrix = useMemo(() => {
    const slotInputs = slots
      .map((s) => ({ slot: s, blocks: blocksBySlot.get(s.id) }))
      .filter((x): x is { slot: SlotRow; blocks: RawBlock[] } => x.blocks != null && x.blocks.length > 0)
      .map(({ slot: s, blocks }) => ({
        startedAt: s.started_at,
        status: s.status,
        paused: s.paused,
        pausedAt: s.paused_at,
        pausedDays: s.paused_days,
        blocks,
      }));
    return buildWeeklyMatrix(slotInputs, productKeys, thisWeekDates);
  }, [slots, blocksBySlot, productKeys, thisWeekDates]);

  // ── 선택 기간 배송 명단 (당일 ~ 기간) ─────────────────────
  // 한 배송 건(정기 1회분 또는 단품 주문). 산출 로직은 lib/delivery-roster 의 SSOT 를 쓴다.
  type DeliveryEntry = RosterEntry<OrderRow, ItemRow>;

  // 임의 날짜(d)의 배송 명단. 정기는 그 요일분, 단품은 ship_date 일치분.
  //   해지·회차소진·정지 구독 제외는 buildRosterForDate 가 배송 탭과 동일하게 처리한다.
  const rosterForDate = useCallback(
    (d: string): DeliveryEntry[] =>
      buildRosterForDate({
        dateISO: d,
        weekday: weekdayOf(d),
        items,
        orderById,
        slotByOrder,
        confirmedOrderIds,
        pausedOrderIds,
        blocksBySlot,
        slotIdByOrder,
        slotById,
      }),
    [items, confirmedOrderIds, pausedOrderIds, orderById, slotByOrder, blocksBySlot, slotIdByOrder, slotById]
  );

  // 임의 날짜의 생산 수요를 정기/단품으로 분리. roster(해지·회차소진·정지 제외)에서
  //   집계하므로 실제 배송 명단과 정합한다 — 생산 계획표가 과배송을 막는다.
  const rosterDemandForDate = useCallback(
    (d: string) => splitDemandByKind(rosterForDate(d)),
    [rosterForDate]
  );

  // 생산 패널용 통합 수요(정기 + 단품). 위 분리 수요를 합쳐 파생 — 동일 SSOT 라
  //   정기/단품 표 합계와 항상 일치한다.
  const onlineDemandForDate = useCallback(
    (d: string): Record<string, number> => {
      const { 정기, 단품 } = rosterDemandForDate(d);
      const merged: Record<string, number> = { ...정기 };
      for (const [k, v] of Object.entries(단품)) merged[k] = (merged[k] ?? 0) + v;
      return merged;
    },
    [rosterDemandForDate]
  );

  // 선택 기간(date ~ dateTo) 날짜 목록. 최대 62일 가드. dateTo<date 면 당일로.
  const rangeDates = useMemo<string[]>(() => {
    const to = dateTo && dateTo >= date ? dateTo : date;
    const out: string[] = [];
    const cur = new Date(`${date}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cur <= end && out.length < 62) {
      out.push(toISODate(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [date, dateTo]);

  // 날짜별 배송 명단 + 포장 묶음(같은 구분·구성품) + 제품 합계.
  const deliveryByDate = useMemo(() => {
    return rangeDates.map((d) => {
      const entries = rosterForDate(d);
      const groups: { kind: "정기" | "단품"; sig: string; rows: DeliveryEntry[] }[] = [];
      for (const row of entries) {
        const last = groups[groups.length - 1];
        if (last && last.kind === row.kind && last.sig === row.sig) last.rows.push(row);
        else groups.push({ kind: row.kind, sig: row.sig, rows: [row] });
      }
      const totals: Record<string, number> = {};
      for (const e of entries) {
        for (const it of e.items) {
          const k = `${it.product_name} ${it.volume}`;
          totals[k] = (totals[k] ?? 0) + it.qty;
        }
      }
      return { date: d, weekday: weekdayOf(d), entries, groups, totals };
    });
  }, [rangeDates, rosterForDate]);

  // 기간 전체 합계(건수/제품).
  const rangeTotals = useMemo(() => {
    const product: Record<string, number> = {};
    let count = 0;
    for (const day of deliveryByDate) {
      count += day.entries.length;
      for (const [k, v] of Object.entries(day.totals)) product[k] = (product[k] ?? 0) + v;
    }
    return { count, product };
  }, [deliveryByDate]);

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

  // ── '오늘 할 일' 대시보드 ─────────────────────────────────
  // 오늘 날짜(now 스냅샷 기반)와 그날 발송해야 할 건수(배송 탭과 동일 SSOT 로스터).
  const todayDateISO = useMemo(() => toISODate(new Date(now)), [now]);
  const todayDispatchCount = useMemo(
    () => rosterForDate(todayDateISO).length,
    [rosterForDate, todayDateISO]
  );
  const anomalyCount = anomalies.paymentNoEvidence.length + anomalies.emptyItems.length;
  // 처리 대기 작업 카드. 수치는 전부 기존 파생값, 클릭은 해당 작업 화면으로 점프한다.
  const todoCards = useMemo<TodoCard[]>(
    () => [
      {
        key: "deposit-wait",
        label: "입금 대기",
        count: pendingOrders.length,
        hint: "PayAction 미등록",
        urgent: true,
        onClick: () => setTab("주문·입금"),
      },
      {
        key: "ship-prep",
        label: "배송준비 대기",
        count: depositPendingCount,
        hint: "입금확인 → 발송",
        onClick: () => setTab("주문·입금"),
      },
      {
        key: "today-dispatch",
        label: "오늘 발송",
        count: todayDispatchCount,
        hint: todayDateISO,
        onClick: () => setTab("배송"),
      },
      {
        key: "refund-wait",
        label: "해지·환불",
        count: cancellations.length,
        hint: refundTotal > 0 ? formatKRW(refundTotal) : undefined,
        onClick: () => setTab("환불·교환"),
      },
      {
        key: "anomaly",
        label: "이상감지",
        count: anomalyCount,
        urgent: true,
        onClick: () => {
          setTab("종합 관리");
          document
            .getElementById("admin-data-check")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
    ],
    [
      pendingOrders.length,
      depositPendingCount,
      todayDispatchCount,
      todayDateISO,
      cancellations.length,
      refundTotal,
      anomalyCount,
    ]
  );

  // ── 회원 전체 + 소비자 분석(CRM) ─────────────────────────
  // 회원별로 누적구매(LTV)·확정주문수·객단가(AOV)·최근주문·활성구독을 집계하고,
  //   최근성(recency)과 구독여부로 고객 등급(세그먼트)을 부여한다.
  type MemberRow = ProfileRow & {
    orderCount: number;
    activeSubs: number;
    ltv: number; // 확정(입금확인 이후) 주문 금액 합계
    confirmedCount: number;
    aov: number; // 객단가 = ltv / confirmedCount
    lastOrderAt: string | null;
    recencyDays: number | null;
    segment: MemberSegment;
  };
  const memberRows = useMemo<MemberRow[]>(() => {
    const orderCountByUser = new Map<string, number>();
    const ltvByUser = new Map<string, number>();
    const confirmedByUser = new Map<string, number>();
    const lastOrderByUser = new Map<string, string>();
    for (const o of orders) {
      orderCountByUser.set(o.user_id, (orderCountByUser.get(o.user_id) ?? 0) + 1);
      const prev = lastOrderByUser.get(o.user_id);
      if (!prev || o.created_at > prev) lastOrderByUser.set(o.user_id, o.created_at);
      if (confirmedOrderIds.has(o.id)) {
        ltvByUser.set(o.user_id, (ltvByUser.get(o.user_id) ?? 0) + o.total_amount);
        confirmedByUser.set(o.user_id, (confirmedByUser.get(o.user_id) ?? 0) + 1);
      }
    }
    const activeByUser = new Map<string, number>();
    for (const s of slots) {
      if (s.status === "활성") activeByUser.set(s.user_id, (activeByUser.get(s.user_id) ?? 0) + 1);
    }
    return [...profiles]
      .map((p) => {
        const activeSubs = activeByUser.get(p.id) ?? 0;
        const confirmedCount = confirmedByUser.get(p.id) ?? 0;
        const ltv = ltvByUser.get(p.id) ?? 0;
        const lastOrderAt = lastOrderByUser.get(p.id) ?? null;
        const recencyDays = lastOrderAt
          ? Math.floor((now - new Date(lastOrderAt).getTime()) / 86_400_000)
          : null;
        const segment: MemberSegment =
          activeSubs > 0
            ? "구독중"
            : confirmedCount === 0
              ? "신규"
              : recencyDays !== null && recencyDays <= 45
                ? "활성"
                : recencyDays !== null && recencyDays <= 90
                  ? "주의"
                  : "휴면";
        return {
          ...p,
          orderCount: orderCountByUser.get(p.id) ?? 0,
          activeSubs,
          ltv,
          confirmedCount,
          aov: confirmedCount ? Math.round(ltv / confirmedCount) : 0,
          lastOrderAt,
          recencyDays,
          segment,
        };
      })
      .sort((a, b) => b.ltv - a.ltv || (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [profiles, orders, slots, confirmedOrderIds, now]);

  // 세그먼트별 인원 — 분석 요약 칩.
  const segmentCounts = useMemo(() => {
    const m: Record<MemberSegment, number> = {
      구독중: 0,
      활성: 0,
      주의: 0,
      휴면: 0,
      신규: 0,
    };
    for (const r of memberRows) m[r.segment] += 1;
    return m;
  }, [memberRows]);

  // 선택한 회원의 분석 요약(모달 헤더용).
  const selectedMemberRow = useMemo(
    () => memberRows.find((m) => m.id === selectedMember) ?? null,
    [memberRows, selectedMember]
  );

  const customer360 = useMemo(() => {
    if (!selectedMember) return null;
    return buildCustomer360({
      userId: selectedMember,
      name: nameByUser.get(selectedMember) ?? "회원",
      orders,
      items,
      slots,
      returns,
      orderEvents: traceEvents,
      smsLog: traceSms,
      profile: selectedMemberRow
        ? {
            name: selectedMemberRow.name ?? "",
            phone: selectedMemberRow.phone ?? "",
            postcode: selectedMemberRow.postcode ?? null,
            address: selectedMemberRow.address ?? null,
            address_detail: selectedMemberRow.address_detail ?? null,
          }
        : null,
      summary: selectedMemberRow
        ? {
            ltv: selectedMemberRow.ltv,
            confirmedCount: selectedMemberRow.confirmedCount,
            aov: selectedMemberRow.aov,
            segment: selectedMemberRow.segment,
            recencyDays: selectedMemberRow.recencyDays,
          }
        : null,
      todayISO: todayISO(),
    });
  }, [selectedMember, selectedMemberRow, orders, items, slots, returns, nameByUser, traceEvents, traceSms]);

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

  // 실수 방지: 같은 전화번호로 가입한 회원(중복 가입 의심)을 표시. 가족 공유일 수도 있어
  //   경고(물음표)로만 노출하고 자동 병합은 하지 않는다. 전체 회원 기준으로 판정.
  const dupPhoneIds = useMemo(
    () => duplicateIds(profiles, (p) => p.id, (p) => normalizePhone(p.phone)),
    [profiles]
  );

  // 실수 방지: 같은 회원의 '신규' 정기구독 주문이 아직 발송 전 상태로 2건 이상이면
  //   중복 주문 의심으로 표시(연장 주문 제외 — 정상적으로 같은 회원에 여러 건이 생긴다).
  //   이중 입금확인·이중 발송을 막기 위한 사전 경고.
  const dupOrderIds = useMemo(() => {
    const PRE_SHIP = ["입금대기", "입금확인", "배송준비"];
    const candidates = orders.filter(
      (o) =>
        o.order_type === "구독" &&
        o.renews_slot_id === null &&
        PRE_SHIP.includes(o.status)
    );
    return duplicateIds(candidates, (o) => o.id, (o) => o.user_id);
  }, [orders]);

  function exportMembersCsv() {
    const rows: string[][] = [
      [
        "이름", "연락처", "우편번호", "주소", "상세주소", "가입일", "마케팅수신",
        "주문수", "활성구독", "누적구매(LTV)", "확정주문", "객단가", "최근주문", "최근경과(일)", "등급",
      ],
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
        String(m.ltv),
        String(m.confirmedCount),
        String(m.aov),
        m.lastOrderAt ? new Date(m.lastOrderAt).toLocaleDateString("ko-KR") : "",
        m.recencyDays === null ? "" : String(m.recencyDays),
        m.segment,
      ]);
    }
    downloadCsv("회원_소비자분석.csv", rows);
  }

  // ── 액션 ─────────────────────────────────────────────────
  async function updateStatus(order: OrderRow, status: string) {
    // 실수 방지: '취소'는 되돌리기 어렵고 연결된 구독·환불이 자동 처리되지 않으므로 확인받는다.
    if (
      status === "취소" &&
      !window.confirm(
        `${order.order_no} 주문을 '취소'로 변경할까요?\n되돌릴 수 없습니다. 정기구독 해지·환불은 별도로 처리해야 합니다.`
      )
    ) {
      return;
    }
    // 실수 방지: 송장 없이 '배송중'으로 바꾸면 고객이 추적할 수 없고, 발송 안내 문자도
    //   나가지 않는다. 게다가 이렇게 먼저 배송중으로 바꾸면 이후 '배송' 탭에서 송장을
    //   입력해도 발송 문자가 발송되지 않는다(문자는 입금확인·배송준비 → 배송중 전이에만 발송).
    //   → '배송' 탭에서 송장을 입력해 자동 전환하도록 권유한다.
    if (
      status === "배송중" &&
      !order.tracking_no &&
      !window.confirm(
        `${order.order_no}: 송장번호가 없습니다.\n` +
          `'배송' 탭에서 송장을 입력하면 자동으로 배송중으로 바뀌고 발송 안내 문자가 나갑니다.\n` +
          `여기서 송장 없이 배송중으로 바꾸면 발송 문자가 나가지 않습니다. 계속할까요?`
      )
    ) {
      return;
    }
    // 실수 방지: '배송완료'로 바꾸면 고객에게 배송 완료 안내 문자가 즉시 발송된다.
    //   실제 수령 전에 잘못 누르면 오안내가 되므로 확인받는다.
    if (
      status === "배송완료" &&
      !window.confirm(
        `${order.order_no}: '배송완료'로 변경하면 고객에게 배송 완료 안내 문자가 발송됩니다. 계속할까요?`
      )
    ) {
      return;
    }
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
      // 클레임 복기: 상태 전이 이력(누가·언제). 감사로그라 실패해도 흐름 무영향.
      void sb.rpc("log_order_event", {
        p_order_id: order.id,
        p_event: "status_change",
        p_from_status: order.status,
        p_to_status: "입금확인",
        p_reason: "연장 입금확인(수기)",
      });
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
    // 쓰기 실패(RLS·제약·일시오류)를 조용히 넘기지 않는다 — 신뢰 경로라 실패 시
    //   문자 발송·후속 처리를 중단하고 관리자에게 즉시 알린다.
    const { error: updErr } = await sb.from("orders").update(patch).eq("id", order.id);
    if (updErr) {
      alert(`주문 상태 변경 실패: ${updErr.message}`);
      return;
    }
    // 클레임 복기: 상태 전이 이력(누가·언제·무엇→무엇). 감사로그라 실패해도 흐름 무영향.
    void sb.rpc("log_order_event", {
      p_order_id: order.id,
      p_event: "status_change",
      p_from_status: order.status,
      p_to_status: status,
      p_reason: status === "입금확인" ? "무통장 입금확인(수기)" : null,
    });
    // 입금확인 → 슬롯을 활성화하고, 요일별 첫 배송일을 시작일로 부여.
    if (status === "입금확인") {
      const { data: pending } = await sb
        .from("subscription_slots")
        .select("id, delivery_day")
        .eq("order_id", order.id)
        .eq("status", "신청");
      const slotErrors: string[] = [];
      for (const s of (pending ?? []) as { id: number; delivery_day: DeliveryDay }[]) {
        const start = toISODate(firstSubscriptionDelivery(s.delivery_day));
        const { error: slotErr } = await sb
          .from("subscription_slots")
          .update({ status: "활성", started_at: start })
          .eq("id", s.id);
        if (slotErr) slotErrors.push(slotErr.message);
      }
      // 슬롯 활성화가 하나라도 실패하면 구독이 실제로는 예약되지 않은 상태다.
      //   이때 "입금 확인·순차 발송" 안내 문자를 보내면 오안내가 되므로, 알림만 띄우고
      //   SMS 는 보내지 않는다(단품은 활성화 대상 슬롯이 없어 항상 성공 → 정상 발송).
      if (slotErrors.length > 0) {
        alert(
          `구독 슬롯 활성화 실패 ${slotErrors.length}건: ${[...new Set(slotErrors)].join(", ")}\n` +
            `입금확인 안내 문자는 보내지 않았습니다. 슬롯 문제 해결 후 다시 시도하세요.`
        );
      } else {
        void notify({ kind: "payment_confirmed", orderId: order.id });
      }
    }
    // 배송완료 → 고객에게 배송 완료 안내 발송.
    if (status === "배송완료") {
      void notify({ kind: "delivered", orderId: order.id });
    }
    // 취소 → 고객(선물이면 보낸 분)에게 취소 안내 발송.
    if (status === "취소") {
      void notify({ kind: "order_cancelled", orderId: order.id });
    }
    await load();
  }

  // 회원 기준 정보(연락처·주소) 정정. 잘못 기재된 회원 프로필을 관리자가 직접 고친다.
  //   RLS(profiles_update_admin)가 관리자에게만 타 회원 수정을 허용한다. 저장 후 재조회.
  async function saveMember(userId: string, values: ProfileEditValues) {
    const sb = getSupabase();
    const { error } = await sb
      .from("profiles")
      .update({
        name: values.name,
        phone: values.phone,
        postcode: values.postcode || null,
        address: values.address || null,
        address_detail: values.address_detail || null,
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    await load();
  }

  // CS 메모 저장 — member_admin_notes 에 upsert(is_admin RLS). 로컬 상태도 갱신해 드로어 유지.
  async function saveMemberMemo(userId: string, memo: string) {
    const sb = getSupabase();
    const { error } = await sb
      .from("member_admin_notes")
      .upsert({ user_id: userId, memo, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    setMemberMemo(memo);
  }

  // 360 단건 문자발송 — 기존 회원 응대용 정보성(거래·CS) 메시지.
  //   정보통신망법: 광고가 아니므로 isAd:false(야간차단·(광고)·동의필터 없음).
  //   광고성은 단체문자 패널의 (광고) 경로만 사용한다(UI 라벨로 안내).
  //   발송 결과는 broadcast 라우트가 sms_log 에 적재 → 복기 타임라인에 자동 반영.
  async function sendMemberSms(phone: string, message: string) {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
    const res = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(buildMemberSmsPayload(phone, message)),
    });
    const r = (await res.json()) as { ok: boolean; reason?: string };
    if (!r.ok) throw new Error(r.reason ?? "발송에 실패했습니다.");
  }

  // 주문 배송지(스냅샷) 정정. 주문엔 주문 시점의 배송지가 따로 저장되므로(프로필과 별개)
  //   이미 들어온 주문의 잘못된 주소·연락처는 이 주문 행에서 직접 고쳐야 배송 명단에 반영된다.
  //   RLS(orders_update_admin)가 관리자에게만 허용한다. 저장 후 재조회.
  async function saveOrderShipping(order: OrderRow, values: ProfileEditValues) {
    const sb = getSupabase();
    const { error } = await sb
      .from("orders")
      .update({
        ship_name: values.name,
        ship_phone: values.phone,
        ship_postcode: values.postcode || null,
        ship_address: values.address,
        ship_address_detail: values.address_detail || null,
      })
      .eq("id", order.id);
    if (error) throw new Error(error.message);
    setEditingShipOrder(null);
    await load();
  }

  // 구독 시작일 연기/지정. 이미 입금했지만 사정상 늦게 시작하려는 고객을 위해,
  //   started_at 을 '기준일 이후 첫 슬롯 요일'로 바꾼다. 그 전까진 발송이 없고 그날부터
  //   시작된다(슬롯은 활성 유지 — 자리는 점유). RLS 상 관리자만 슬롯 수정 가능.
  async function deferStart(slot: SlotRow, baseISO: string) {
    if (!baseISO) {
      alert("시작 기준일을 선택해 주세요.");
      return;
    }
    const newStart = firstDeliveryOnOrAfter(slot.delivery_day, baseISO);
    const { error } = await getSupabase()
      .from("subscription_slots")
      .update({ started_at: newStart })
      .eq("id", slot.id);
    if (error) {
      alert(`구독 시작일 변경 실패: ${error.message}`);
      return;
    }
    setStartDeferOrder(null);
    setStartDeferDate("");
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
    const { error } = await sb.from("orders").update(patch).eq("id", order.id);
    if (error) {
      alert(`송장 저장 실패: ${error.message}`);
      return;
    }
    const shippedTransition = Boolean(tracking) && (order.status === "입금확인" || order.status === "배송준비");
    // 클레임 복기: 발송/송장 이력(누가·언제·택배사·송장). 감사로그라 실패해도 흐름 무영향.
    void sb.rpc("log_order_event", {
      p_order_id: order.id,
      p_event: shippedTransition ? "shipped" : "tracking_update",
      p_from_status: order.status,
      p_to_status: shippedTransition ? "배송중" : null,
      p_meta: { courier: courier || null, tracking_no: tracking || null },
    });
    // 새로 '배송중'으로 전환된 건에만 발송 안내 — 이미 배송중인 주문을 재저장할 때
    //   중복 발송 문자를 보내지 않는다(상태 전이일 때만 발송).
    if (shippedTransition) {
      void notify({ kind: "shipped", orderId: order.id });
    }
    await load();
  }

  // 화면의 배송 명단(선택 날짜 기준, 정기+단품)을 그대로 CSV로 내보낸다.
  //   정기 건은 '이번이 총 몇 회 중 몇 회차 발송인지'와 '구독 기간(총 회차)'을 회차 형식으로
  //   적어, 날짜만으로는 알 수 없던 '8회 구독자의 1회차 발송' 같은 정보를 한눈에 보이게 한다.
  function exportDeliveryCsv() {
    // 정기 주문의 (이번 회차 / 총 회차) 계산. d = 발송일(YYYY-MM-DD).
    //   총 회차 = 원주문 회차(block_weeks) + 연장 누적(extended_weeks).
    //   이번 회차 = 그 발송일 기준 누적 발송 수(스케줄로 산출, 정지일 반영).
    const subProgress = (o: OrderRow, d: string): { progress: string; period: string } => {
      const slot = slotByOrder.get(o.id);
      const total = Math.max(0, (o.block_weeks ?? 0) + (slot?.extended_weeks ?? 0));
      const period = total > 0 ? `${total}회(${total}주)` : "";
      if (!slot?.started_at || total === 0) {
        return { progress: total > 0 ? `예정 / ${total}회` : "", period };
      }
      const sched = computeSchedule(
        {
          startedAt: slot.started_at,
          totalWeeks: total,
          paused: slot.paused,
          pausedAt: slot.paused_at,
          pausedDays: slot.paused_days,
        },
        new Date(`${d}T00:00:00`)
      );
      const nth = Math.min(Math.max(sched.delivered, 1), total);
      return { progress: `${nth} / ${total}회차`, period };
    };

    const rows: string[][] = [
      ["발송일", "요일", "구분", "정기회차", "구독기간", "포장묶음", "주문번호", "이름", "보낸이(선물)", "연락처", "우편번호", "주소", "상세주소", "제품(수량)", "상태"],
    ];
    for (const day of deliveryByDate) {
      const label = day.weekday ? DELIVERY_DAY_LABEL[day.weekday] : "주말";
      day.groups.forEach((g, gi) => {
        for (const { order: o, items: its } of g.rows) {
          const sub = g.kind === "정기" ? subProgress(o, day.date) : { progress: "단품(1회)", period: "-" };
          rows.push([
            day.date,
            label,
            g.kind,
            sub.progress,
            sub.period,
            String(gi + 1),
            o.order_no,
            o.ship_name,
            giftSenderCsv(o.is_gift, o.gifter_name),
            o.ship_phone,
            o.ship_postcode ?? "",
            o.ship_address,
            o.ship_address_detail ?? "",
            its.map((it) => `${it.product_name} ${it.volume}×${it.qty}`).join(" / "),
            o.status,
          ]);
        }
      });
    }
    downloadCsv(`배송명단_${date}_${dateTo}.csv`, rows);
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

      {/* AI 비서 — 모든 탭에서 우하단 플로팅으로 접근(읽기 전용 즉답) */}
      <AdminAssistant />

      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">Admin · 물류 ERP</p>
          <h1 className="mt-2 font-serif-kr text-[clamp(1.6rem,4vw,2.2rem)] font-medium text-ink">
            송영신목장 관리자
          </h1>
          <p className="mt-1.5 flex items-center gap-2 text-[12px] text-mute no-print">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            30초마다 자동 새로고침
            {lastRefreshed && (
              <span className="tabular-nums">· 마지막 {lastRefreshed.toLocaleTimeString("ko-KR")}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          {depositPendingCount > 0 && (
            <button
              onClick={() => setTab("주문·입금")}
              className="rounded-full bg-gold/15 px-3 py-2 text-[14px] font-medium text-gold-deep hover:bg-gold/25"
            >
              입금확인 {depositPendingCount}건 · 배송준비 대기
            </button>
          )}
          <Link href="/admin/news" className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
            소식 전하기
          </Link>
          <Link href="/admin/news-radar" className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
            소식 레이더
          </Link>
          <button onClick={() => load()} className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
            새로고침
          </button>
          <button onClick={() => window.print()} className="rounded-full bg-ink px-4 py-2 text-[14px] text-cream hover:bg-gold-deep">
            보고서 출력
          </button>
        </div>
      </div>

      {/* 전역 검색 — 어느 탭에서든 회원·주문을 한 입력칸으로 찾아 360 직행 */}
      <div className="mt-5 no-print">
        <AdminGlobalSearch
          members={searchMembers}
          orders={orders}
          onOpenMember={(userId) => setSelectedMember(userId)}
          onOpenGuestOrder={(orderNo) => focusOrderInManageTab(orderNo)}
        />
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

      {tab === "상품·재고" && (
        <>
          <ProductAdminPanel />
          <InventoryPanel />
        </>
      )}

      {tab === "배송" && (
        <DispatchPanel
          orders={orders}
          itemsByOrder={itemsByOrder}
          slots={slots}
          shippedKeys={shippedKeys}
          onReload={load}
        />
      )}

      {tab === "환불·교환" && <ReturnsPanel orders={orders} />}

      {tab === "정산·세금" && <SettlementPanel orders={orders} />}

      {tab === "종합 관리" && (
        <>
      {loading && <p className="mt-8 text-[14px] text-mute">데이터 불러오는 중…</p>}

      {/* 오늘 할 일 — 처리 대기 작업을 한눈에, 클릭 시 해당 화면으로 점프 */}
      <AdminTodayBoard cards={todoCards} />

      {/* 개요 */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="회원 수" value={`${profiles.length}명`} />
        <Stat label="총 주문" value={`${orders.length}건`} />
        <Stat label="확정 구독 매출" value={formatKRW(revenue)} />
        <Stat label="대기자" value={`${waitlist.length}명`} />
      </section>

      {/* 데이터 점검 — 결제상태/품목 이상 자동 탐지 */}
      {(anomalies.paymentNoEvidence.length > 0 || anomalies.emptyItems.length > 0) && (
        <section id="admin-data-check" className="mt-6 scroll-mt-6 rounded-2xl border border-amber-300 bg-amber-50/60 p-5 no-print">
          <h2 className="font-serif-kr text-lg text-amber-800">⚠ 데이터 점검 필요</h2>
          <p className="mt-1 text-[13px] text-amber-700">
            배포·접속 시점 등으로 생길 수 있는 이상 주문입니다. 아래 건을 주문 관리에서 확인해 주세요.
          </p>
          {anomalies.paymentNoEvidence.length > 0 && (
            <div className="mt-4">
              <p className="text-[14px] font-medium text-ink">
                입금 근거 없이 입금확인된 주문 ({anomalies.paymentNoEvidence.length}건)
                <span className="ml-1.5 text-[12px] font-normal text-mute">
                  — 상태는 입금확인 이후인데 결제확인 시각이 없습니다. 실입금을 확인하고, 아니면 ‘입금대기’로 되돌리세요.
                </span>
              </p>
              <ul className="mt-2 space-y-1">
                {anomalies.paymentNoEvidence.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 text-[13px] text-ink-soft">
                    <button
                      onClick={() => focusOrderInManageTab(o.order_no)}
                      className="tabular-nums text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-ink"
                    >
                      {o.order_no}
                    </button>
                    <span className="text-ink">{nameByUser.get(o.user_id) ?? o.ship_name ?? "—"}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] text-amber-800">{o.status}</span>
                    <span className="tabular-nums text-mute">{formatKRW(o.total_amount)}</span>
                    <span className="text-mute">{new Date(o.created_at).toLocaleDateString("ko-KR")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {anomalies.emptyItems.length > 0 && (
            <div className="mt-4">
              <p className="text-[14px] font-medium text-ink">
                담긴 품목이 없는 주문 ({anomalies.emptyItems.length}건)
                <span className="ml-1.5 text-[12px] font-normal text-mute">
                  — 주문상품·수량이 비어 있습니다. 새로고침해도 남으면 실제 누락이니 확인이 필요합니다.
                </span>
              </p>
              <ul className="mt-2 space-y-1">
                {anomalies.emptyItems.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-3 text-[13px] text-ink-soft">
                    <button
                      onClick={() => focusOrderInManageTab(o.order_no)}
                      className="tabular-nums text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-ink"
                    >
                      {o.order_no}
                    </button>
                    <span className="text-ink">{nameByUser.get(o.user_id) ?? o.ship_name ?? "—"}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] text-amber-800">{o.status}</span>
                    <span className="tabular-nums text-mute">{formatKRW(o.total_amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 전환 퍼널 — 측정 대시보드 */}
      <div className="mt-6 no-print">
        <FunnelDashboard />
      </div>

      {/* 친구 추천(리퍼럴) 현황 + 보상 원장 */}
      <div className="mt-6 no-print">
        <ReferralAdminPanel />
      </div>

      {/* 통계 분석 */}
      <AdminStats orders={orders} items={items} slots={slots} returns={returns} memberCount={profiles.length} />
        </>
      )}

      {tab === "회원·구독" && (
        <>
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
      {/* 세그먼트 요약 — 등급별 인원 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {SEGMENTS.map((seg) => (
          <span
            key={seg}
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${SEGMENT_TONE[seg]}`}
          >
            {seg} {segmentCounts[seg]}
          </span>
        ))}
        <span className="rounded-full border border-line px-3 py-1 text-[13px] text-mute">
          정렬: 누적구매 높은 순
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">이름</th>
              <th className="py-2 font-normal">등급</th>
              <th className="py-2 font-normal">연락처</th>
              <th className="py-2 font-normal">주소</th>
              <th className="py-2 font-normal">가입일</th>
              <th className="py-2 text-center font-normal">마케팅</th>
              <th className="py-2 text-right font-normal">주문</th>
              <th className="py-2 text-right font-normal">활성구독</th>
              <th className="py-2 text-right font-normal">누적구매</th>
              <th className="py-2 text-right font-normal">최근주문</th>
            </tr>
          </thead>
          <tbody>
            {filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-4 text-center text-mute">
                  {memberRows.length === 0 ? "회원이 없습니다." : "검색 결과가 없습니다."}
                </td>
              </tr>
            ) : (
              filteredMembers.map((m) => (
                <tr key={m.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5">
                    <button
                      onClick={() => setSelectedMember(m.id)}
                      className="text-ink underline decoration-line underline-offset-2 transition-colors hover:text-gold-deep hover:decoration-gold"
                    >
                      {m.name || "—"}
                    </button>
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${SEGMENT_TONE[m.segment]}`}
                    >
                      {m.segment}
                    </span>
                  </td>
                  <td className="py-2.5 tabular-nums text-ink-soft">
                    {m.phone || "—"}
                    {dupPhoneIds.has(m.id) && (
                      <span
                        title="같은 전화번호로 가입한 회원이 또 있습니다. 중복 가입인지 확인하세요."
                        className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                      >
                        중복 전화?
                      </span>
                    )}
                  </td>
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
                  <td className="py-2.5 text-right tabular-nums text-ink">{m.ltv ? formatKRW(m.ltv) : "·"}</td>
                  <td className="py-2.5 text-right tabular-nums text-mute">
                    {m.lastOrderAt ? new Date(m.lastOrderAt).toLocaleDateString("ko-KR") : "·"}
                  </td>
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
        </>
      )}

      {tab === "생산·재고" && (
        <>
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

      {/* 이번 주(월~금) 통합 생산·배송 계획 */}
      <WeeklyPlanTable productKeys={productKeys} demandForDate={rosterDemandForDate} />
        </>
      )}

      {/* 기간별 배송 명단 — 배송 탭에서 작업 화면(DispatchPanel) 아래에 노출 */}
      {tab === "배송" && (
        <>
      {/* 기간별 배송 명단 — 당일 또는 기간(from~to) 선택. 기본 접힘. */}
      <button
        type="button"
        onClick={() => setShowRoster((v) => !v)}
        aria-expanded={showRoster}
        className="mt-12 flex items-center gap-2 font-serif-kr text-lg text-ink"
      >
        <span className="text-mute">{showRoster ? "▾" : "▸"}</span>
        기간별 배송 명단
        <span className="font-sans text-[13px] text-mute">{showRoster ? "접기" : "펼치기"}</span>
      </button>
      {showRoster && (
        <>
      <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
          aria-label="배송 시작일"
        />
        <span className="text-mute">~</span>
        <input
          type="date"
          value={dateTo}
          min={date}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
          aria-label="배송 종료일"
        />
        <button
          onClick={() => setDateTo(date)}
          className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
        >
          당일
        </button>
        <button
          onClick={() => {
            const e = new Date(`${date}T00:00:00`);
            e.setDate(e.getDate() + 6);
            setDateTo(toISODate(e));
          }}
          className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
        >
          7일
        </button>
        {rangeTotals.count > 0 && (
          <button
            onClick={exportDeliveryCsv}
            className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold-deep"
          >
            배송 명단 CSV
          </button>
        )}
      </div>

      {rangeTotals.count > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-ink/8 px-3 py-1 text-[13px] font-medium text-ink">
            기간 합계 {rangeTotals.count}건
          </span>
          {Object.entries(rangeTotals.product).map(([k, v]) => (
            <span key={k} className="rounded-full bg-gold/10 px-3 py-1 text-[13px] text-gold-deep">
              {k} · {v}개
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-8">
        {rangeTotals.count === 0 ? (
          <p className="text-[14px] text-mute">선택하신 기간에 배송분이 없습니다.</p>
        ) : (
          deliveryByDate
            .filter((day) => day.entries.length > 0)
            .map((day) => (
              <div key={day.date}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
                  <h3 className="font-serif-kr text-[15px] text-ink">
                    {day.date} ({day.weekday ? DELIVERY_DAY_LABEL[day.weekday] : "주말"})
                  </h3>
                  <span className="text-[13px] text-mute">{day.entries.length}건</span>
                  <span className="flex flex-wrap gap-1.5 no-print">
                    {Object.entries(day.totals).map(([k, v]) => (
                      <span key={k} className="rounded-full bg-gold/10 px-2.5 py-0.5 text-[12px] text-gold-deep">
                        {k} {v}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="mt-3 overflow-x-auto">
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
                      {day.groups.map((g, gi) => (
                        <Fragment key={`${day.date}-${g.kind}-${gi}`}>
                          <tr className="bg-gold/8">
                            <td colSpan={5} className="px-1 py-2 text-[13px] font-medium text-gold-deep">
                              <span
                                className={`mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                                  g.kind === "단품" ? "bg-ink/10 text-ink" : "bg-gold/20 text-gold-deep"
                                }`}
                              >
                                {g.kind}
                              </span>
                              포장 묶음 {gi + 1} · {g.sig} <span className="text-mute">({g.rows.length}건)</span>
                            </td>
                          </tr>
                          {g.rows.map(({ order, items: its }) => (
                            <tr key={order.id} className="border-b border-line/60 align-top">
                              <td className="py-2.5 text-ink">
                                {order.ship_name}
                                {giftSenderLabel(order.is_gift, order.gifter_name) && (
                                  <span className="mt-0.5 block text-[12px] text-gold-deep">
                                    🎁 {giftSenderLabel(order.is_gift, order.gifter_name)}
                                  </span>
                                )}
                              </td>
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
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
        )}
      </div>
        </>
      )}
        </>
      )}

      {tab === "회원·구독" && (
        <>
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
        </>
      )}

      {tab === "환불·교환" && (
        <>
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
        </>
      )}

      {tab === "회원·구독" && (
        <>
      {/* 단체문자 발송 */}
      <BroadcastPanel profiles={profiles} slots={slots} />
        </>
      )}

      {tab === "주문·입금" && (
        <>
      {/* 주문 관리 — 상태 변경 */}
      <div id="order-manage" className="mt-12 flex flex-wrap items-center justify-between gap-2 scroll-mt-24">
        <h2 className="font-serif-kr text-lg text-ink">주문 관리</h2>
        {pendingOrders.length > 0 && (
          <div className="flex flex-col items-end gap-1 no-print">
            <button
              type="button"
              onClick={batchReRegister}
              disabled={batchRunning}
              className="rounded-full border border-line px-3 py-1 text-[13px] font-medium text-mute transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-50"
            >
              {batchRunning ? "재등록 중…" : `입금대기 ${pendingOrders.length}건 PayAction 일괄 재등록`}
            </button>
            {batchSummary && (
              <span className="text-[12px] leading-snug text-ink-soft">{batchSummary}</span>
            )}
          </div>
        )}
      </div>
      <p className="mt-1 text-[13px] text-mute">상태를 변경하면 저장됩니다. ‘입금확인’으로 바꾸면 입금이 확인된 것으로 보고 구독이 활성화됩니다. 입금대기 주문이 PayAction에 등록되지 않아 자동매칭이 안 될 때 ‘재등록’을 눌러 다시 시도하세요.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
        <input
          type="search"
          value={orderQuery}
          onChange={(e) => setOrderQuery(e.target.value)}
          placeholder="이름·입금자·주문번호·연락처 검색"
          className="min-w-[220px] flex-1 rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
        <select
          value={orderStatusFilter}
          onChange={(e) => setOrderStatusFilter(e.target.value)}
          className="rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        >
          <option value="전체">전체 상태</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="tabular-nums text-[13px] text-mute">{managedOrders.length}건</span>
        {(orderQuery || orderStatusFilter !== "전체") && (
          <button
            onClick={() => {
              setOrderQuery("");
              setOrderStatusFilter("전체");
            }}
            className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep"
          >
            초기화
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[640px]">
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
            {managedOrders.length === 0 ? (
              <tr><td colSpan={7} className="py-4 text-center text-mute">{orders.length === 0 ? "주문이 없습니다." : "검색 결과가 없습니다."}</td></tr>
            ) : (
              managedOrders.map((o) => {
                const orderItems = itemsByOrder.get(o.id) ?? [];
                const open = expandedOrder === o.id;
                return (
                <Fragment key={o.id}>
                <tr className="border-b border-line/60 align-top">
                  <td data-label="주문번호" className="py-2.5 tabular-nums text-ink">
                    <button
                      onClick={() => setExpandedOrder(open ? null : o.id)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-gold-deep"
                      aria-expanded={open}
                    >
                      <span className={`text-[11px] text-mute transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                      {o.order_no}
                    </button>
                    {o.renews_slot_id && (
                      <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-medium text-gold-deep">
                        연장
                      </span>
                    )}
                    {dupOrderIds.has(o.id) && (
                      <span
                        title="같은 회원의 발송 전 정기구독 주문이 2건 이상입니다. 중복 주문인지 확인하세요."
                        className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                      >
                        중복 의심
                      </span>
                    )}
                  </td>
                  <td data-label="입금자" className="py-2.5 text-ink-soft">
                    <button
                      type="button"
                      onClick={() => setSelectedMember(o.user_id)}
                      className="text-ink underline decoration-line underline-offset-2 transition-colors hover:text-gold-deep hover:decoration-gold"
                    >
                      {o.depositor_name ?? o.ship_name}
                    </button>
                    {o.is_gift && (
                      <span className="mt-0.5 block text-[12px] text-gold-deep">
                        🎁 선물 → 받는분 {o.ship_name}
                      </span>
                    )}
                  </td>
                  <td data-label="금액" className="py-2.5 text-right tabular-nums text-ink-soft">{formatKRW(o.total_amount)}</td>
                  <td data-label="신청일" className="py-2.5 text-mute">{new Date(o.created_at).toLocaleDateString("ko-KR")}</td>
                  <td data-label="현금영수증" className="py-2.5">
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
                  <td data-label="상태" className="py-2.5 no-print">
                    <div className="flex flex-col items-start gap-1.5">
                      <select
                        value={o.status}
                        onChange={(e) => updateStatus(o, e.target.value)}
                        className="rounded-lg border border-line bg-cream px-2 py-1 text-[14px] text-ink"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      {o.status === "입금대기" && (
                        <PayActionReRegister orderNo={o.order_no} onDone={() => load()} />
                      )}
                    </div>
                  </td>
                  <td data-label="배송 추적" className="py-2.5 no-print">
                    <TrackingCell order={o} onSave={saveTracking} />
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-line/60 bg-paper-2/40">
                    <td colSpan={7} className="px-4 py-3">
                      {orderItems.length === 0 ? (
                        <span className="text-[13px] text-mute">담긴 품목 정보가 없습니다.</span>
                      ) : (
                        <ul className="flex flex-wrap gap-x-6 gap-y-1.5">
                          {orderItems.map((it) => (
                            <li key={it.id} className="text-[13px] text-ink-soft">
                              {it.product_name} <span className="text-mute">{it.volume}</span>
                              {it.delivery_day && (
                                <span className="ml-1 text-mute">
                                  ({DELIVERY_DAY_LABEL[it.delivery_day]})
                                </span>
                              )}
                              <span className="ml-1.5 tabular-nums text-ink">×{it.qty}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* 구독 시작일 연기/지정 — 입금했으나 늦게 시작하려는 고객용 */}
                      {o.order_type === "구독" &&
                        (() => {
                          const slot = slotByOrder.get(o.id);
                          if (!slot || slot.status === "해지") return null;
                          return (
                            <div className="mt-3 border-t border-line/60 pt-3">
                              {startDeferOrder === o.id ? (
                                <div className="flex flex-wrap items-end gap-2">
                                  <label className="text-[13px] text-ink-soft">
                                    <span className="mr-2 text-mute">시작 기준일</span>
                                    <input
                                      type="date"
                                      value={startDeferDate}
                                      onChange={(e) => setStartDeferDate(e.target.value)}
                                      className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
                                    />
                                  </label>
                                  <span className="text-[12px] text-mute">
                                    → {startDeferDate
                                      ? `${firstDeliveryOnOrAfter(slot.delivery_day, startDeferDate)} (${DELIVERY_DAY_LABEL[slot.delivery_day]}) 첫 발송`
                                      : "날짜 선택 시 첫 발송일 미리보기"}
                                  </span>
                                  <button
                                    onClick={() => deferStart(slot, startDeferDate)}
                                    className="rounded-full bg-ink px-3 py-1.5 text-[13px] text-cream hover:opacity-90"
                                  >
                                    적용
                                  </button>
                                  <button
                                    onClick={() => {
                                      setStartDeferOrder(null);
                                      setStartDeferDate("");
                                    }}
                                    className="rounded-full px-3 py-1.5 text-[13px] text-mute hover:text-ink"
                                  >
                                    취소
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-[13px] leading-relaxed text-ink-soft">
                                    <span className="text-mute">구독 시작일 · </span>
                                    {slot.started_at
                                      ? `${slot.started_at} (${DELIVERY_DAY_LABEL[slot.delivery_day]})`
                                      : "미시작"}
                                  </p>
                                  <button
                                    onClick={() => {
                                      setStartDeferOrder(o.id);
                                      setStartDeferDate(slot.started_at ?? "");
                                    }}
                                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                                  >
                                    시작일 변경
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      {/* 배송지(이 주문의 스냅샷) — 잘못 기재된 주소·연락처 정정 */}
                      <div className="mt-3 border-t border-line/60 pt-3">
                        {editingShipOrder === o.id ? (
                          <div className="max-w-md">
                            <p className="mb-2 text-[13px] font-medium text-ink">배송지 수정</p>
                            <ProfileEditor
                              initial={{
                                name: o.ship_name ?? "",
                                phone: o.ship_phone ?? "",
                                postcode: o.ship_postcode ?? "",
                                address: o.ship_address ?? "",
                                address_detail: o.ship_address_detail ?? "",
                              }}
                              saveLabel="배송지 저장"
                              onSave={(values) => saveOrderShipping(o, values)}
                              onCancel={() => setEditingShipOrder(null)}
                            />
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[13px] leading-relaxed text-ink-soft">
                              <span className="text-mute">배송지 · </span>
                              {o.ship_name} {o.ship_phone}
                              <br />
                              <span className="text-mute">
                                ({o.ship_postcode}) {o.ship_address} {o.ship_address_detail ?? ""}
                              </span>
                            </p>
                            <button
                              onClick={() => setEditingShipOrder(o.id)}
                              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
                            >
                              배송지 수정
                            </button>
                          </div>
                        )}
                      </div>
                      {/* 현금영수증 과세/면세 분리 — 페이액션 ‘발행하기’에 그대로 입력 */}
                      {o.cash_receipt_type && o.cash_receipt_type !== "발행안함" && (
                        <CashReceiptBreakdown order={o} items={orderItems} />
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })
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

      {customer360 && (
        <Customer360Drawer
          key={selectedMember}
          data={customer360}
          onSaveMember={
            selectedMemberRow ? (values) => saveMember(selectedMember!, values) : undefined
          }
          memo={memberMemo}
          onSaveMemo={(memo) => saveMemberMemo(selectedMember!, memo)}
          onSendSms={
            selectedMemberRow?.phone
              ? (message) => sendMemberSms(selectedMemberRow.phone!, message)
              : undefined
          }
          onClose={() => setSelectedMember(null)}
        />
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

// 현금영수증 발행 보조 — 이 주문의 면세금액·공급가액·부가세를 계산해 보여 준다.
//   우유=면세, 요거트=과세(가격은 부가세 포함가). 관리자는 이 값을 페이액션
//   현금영수증 '발행하기'(거래구분·식별번호·금액)에 그대로 입력하면 된다.
function CashReceiptBreakdown({ order, items }: { order: OrderRow; items: ItemRow[] }) {
  const amt = computeCashReceiptAmounts(
    items.map((it) => ({ productId: it.product_id, unitPrice: it.unit_price, qty: it.qty })),
    order.total_amount
  );
  const purpose = order.cash_receipt_type === "지출증빙" ? "지출증빙용" : "소득공제용";
  return (
    <div className="mt-3 rounded-xl border border-line/60 bg-cream/60 px-3 py-2.5">
      <p className="text-[13px] font-medium text-ink">
        현금영수증 발행 정보
        {order.cash_receipt_issued && (
          <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-normal text-gold-deep">
            발행완료 표시됨
          </span>
        )}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft">
        <span>거래구분 <span className="font-medium text-ink">{purpose}</span></span>
        <span>식별번호 <span className="tabular-nums font-medium text-ink">{order.cash_receipt_id ?? "—"}</span></span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums text-ink-soft">
        <span>면세금액 <span className="font-medium text-ink">{formatKRW(amt.taxFreeAmount)}</span></span>
        <span>공급가액 <span className="font-medium text-ink">{formatKRW(amt.supplyAmount)}</span></span>
        <span>부가세 <span className="font-medium text-ink">{formatKRW(amt.vat)}</span></span>
        <span>합계 <span className="font-medium text-gold-deep">{formatKRW(amt.total)}</span></span>
      </div>
      <p className="mt-1.5 text-[12px] text-mute">
        ※ 실제 발행은 <span className="text-ink-soft">페이액션 ‘현금영수증 → 발행하기’</span>에서 하세요. 우리 시스템은 발행하지 않습니다(중복발행 방지).
      </p>
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
