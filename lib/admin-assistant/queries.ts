// 관리자 AI 비서의 읽기 전용 계산(순수 함수). 라우트가 Supabase 행을 넘기면 답 데이터를 만든다.
//   admin 화면의 집계 규칙(확정 상태 + 일시정지 제외, 정기 요일분 + 단품 ship_date)과 동일하게 맞춘다.
//   순수 함수라 단위 테스트로 보장한다(AI 가 숫자를 지어내지 않게, 사실은 여기서만 계산).
import { kstYmd } from "../kst";

export type DeliveryDay = "mon" | "tue" | "wed" | "thu" | "fri";

export const DAY_LABEL: Record<DeliveryDay, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
};

// 확정(입금확인 이후) 상태 — admin 의 CONFIRMED 와 동일하게 유지.
export const CONFIRMED_STATUSES = ["입금확인", "배송준비", "배송중", "배송완료"] as const;

export type OrderLite = {
  id: string;
  order_no: string;
  status: string;
  order_type: string; // '구독' | '단품'
  ship_date: string | null;
  total_amount: number;
  depositor_name: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  created_at: string;
};

export type ItemLite = {
  order_id: string;
  product_name: string;
  volume: string;
  delivery_day: DeliveryDay | null;
  qty: number;
};

export type SlotLite = {
  order_id: string | null;
  delivery_day: DeliveryDay;
  status: string;
  paused: boolean;
};

const JS_DAY: Record<number, DeliveryDay | null> = {
  0: null,
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: null,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO 날짜 → 배송 요일키(주말은 null).
export function weekdayOf(iso: string): DeliveryDay | null {
  const [y, mo, da] = iso.split("-").map(Number);
  return y ? JS_DAY[new Date(y, mo - 1, da).getDay()] : null;
}

// 기간(from~to) 날짜 목록. to<from 이면 from 하루만. cap 으로 상한.
export function enumerateDates(fromISO: string, toISO: string, cap = 62): string[] {
  const to = toISO && toISO >= fromISO ? toISO : fromISO;
  const out: string[] = [];
  const cur = new Date(`${fromISO}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end && out.length < cap) {
    out.push(isoOf(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function confirmedIds(orders: OrderLite[]): Set<string> {
  return new Set(
    orders.filter((o) => (CONFIRMED_STATUSES as readonly string[]).includes(o.status)).map((o) => o.id)
  );
}

export function pausedOrderIds(slots: SlotLite[]): Set<string> {
  return new Set(slots.filter((s) => s.paused && s.order_id).map((s) => s.order_id as string));
}

export type RosterRow = {
  kind: "정기" | "단품";
  name: string;
  phone: string;
  address: string;
  products: string;
  status: string;
};

// 한 날짜의 배송 명단(정기 요일분 + 단품 ship_date), 확정·미정지만.
export function rosterForDate(
  d: string,
  orders: OrderLite[],
  items: ItemLite[],
  confirmed: Set<string>,
  paused: Set<string>
): RosterRow[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const grouped = new Map<string, ItemLite[]>();
  const wd = weekdayOf(d);

  for (const it of items) {
    const o = byId.get(it.order_id);
    if (!o) continue;
    if (!confirmed.has(o.id)) continue;
    const isSub = o.order_type !== "단품";
    if (isSub) {
      if (!wd || it.delivery_day !== wd) continue;
      if (paused.has(o.id)) continue;
    } else {
      if (o.ship_date !== d) continue;
    }
    const arr = grouped.get(o.id) ?? [];
    arr.push(it);
    grouped.set(o.id, arr);
  }

  const rows: RosterRow[] = [];
  for (const [orderId, its] of grouped) {
    const o = byId.get(orderId)!;
    rows.push({
      kind: o.order_type === "단품" ? "단품" : "정기",
      name: o.ship_name,
      phone: o.ship_phone,
      address: `(${o.ship_postcode ?? ""}) ${o.ship_address} ${o.ship_address_detail ?? ""}`.trim(),
      products: its.map((it) => `${it.product_name} ${it.volume}×${it.qty}`).join(", "),
      status: o.status,
    });
  }
  rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "ko") : a.kind === "정기" ? -1 : 1));
  return rows;
}

// 기간 배송 명단(날짜별). 빈 날짜는 제외.
export function deliveryRoster(
  orders: OrderLite[],
  items: ItemLite[],
  slots: SlotLite[],
  fromISO: string,
  toISO: string
): { date: string; weekday: DeliveryDay | null; rows: RosterRow[] }[] {
  const confirmed = confirmedIds(orders);
  const paused = pausedOrderIds(slots);
  return enumerateDates(fromISO, toISO)
    .map((d) => ({ date: d, weekday: weekdayOf(d), rows: rosterForDate(d, orders, items, confirmed, paused) }))
    .filter((day) => day.rows.length > 0);
}

// 생산 수요(기간 전체 제품별 합계). 배송 명단과 같은 규칙.
export function productionDemand(
  orders: OrderLite[],
  items: ItemLite[],
  slots: SlotLite[],
  fromISO: string,
  toISO: string
): { dates: string[]; total: Record<string, number>; byDate: { date: string; total: Record<string, number> }[] } {
  const confirmed = confirmedIds(orders);
  const paused = pausedOrderIds(slots);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const dates = enumerateDates(fromISO, toISO);
  const total: Record<string, number> = {};
  const byDate = dates.map((d) => {
    const wd = weekdayOf(d);
    const dayTotal: Record<string, number> = {};
    for (const it of items) {
      const o = byId.get(it.order_id);
      if (!o || !confirmed.has(o.id)) continue;
      const isSub = o.order_type !== "단품";
      if (isSub) {
        if (!wd || it.delivery_day !== wd || paused.has(o.id)) continue;
      } else if (o.ship_date !== d) {
        continue;
      }
      const key = `${it.product_name} ${it.volume}`;
      dayTotal[key] = (dayTotal[key] ?? 0) + it.qty;
      total[key] = (total[key] ?? 0) + it.qty;
    }
    return { date: d, total: dayTotal };
  });
  return { dates, total, byDate };
}

// 매출 요약(기간 내 확정 주문). created_at 기준.
export function salesSummary(
  orders: OrderLite[],
  fromISO: string,
  toISO: string
): { count: number; revenue: number } {
  const to = toISO && toISO >= fromISO ? toISO : fromISO;
  let count = 0;
  let revenue = 0;
  for (const o of orders) {
    if (!(CONFIRMED_STATUSES as readonly string[]).includes(o.status)) continue;
    const day = kstYmd(o.created_at ?? ""); // UTC → KST 일자(일 경계 오귀속 방지)
    if (day < fromISO || day > to) continue;
    count += 1;
    revenue += o.total_amount ?? 0;
  }
  return { count, revenue };
}

// 주문 조회(이름·입금자·주문번호·연락처 부분일치 + 상태 옵션). 최신순 상한.
export function findOrders(
  orders: OrderLite[],
  opts: { query?: string; status?: string; limit?: number }
): Array<Pick<OrderLite, "order_no" | "status" | "ship_name" | "depositor_name" | "ship_phone" | "total_amount" | "created_at">> {
  const q = (opts.query ?? "").trim().toLowerCase();
  const limit = opts.limit ?? 20;
  return orders
    .filter((o) => {
      if (opts.status && o.status !== opts.status) return false;
      if (!q) return true;
      const hay = [o.order_no, o.depositor_name ?? "", o.ship_name, o.ship_phone].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, limit)
    .map((o) => ({
      order_no: o.order_no,
      status: o.status,
      ship_name: o.ship_name,
      depositor_name: o.depositor_name,
      ship_phone: o.ship_phone,
      total_amount: o.total_amount,
      created_at: o.created_at,
    }));
}

// 요일별 모집현황(정원 100명 대비 신청·활성 슬롯 수) + 대기자 수.
export function recruitmentStatus(slots: SlotLite[]): {
  byDay: Record<DeliveryDay, number>;
  waitlist: number;
} {
  const byDay: Record<DeliveryDay, number> = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
  let waitlist = 0;
  for (const s of slots) {
    if (s.status === "신청" || s.status === "활성") {
      if (byDay[s.delivery_day] !== undefined) byDay[s.delivery_day] += 1;
    } else if (s.status === "대기") {
      waitlist += 1;
    }
  }
  return { byDay, waitlist };
}
