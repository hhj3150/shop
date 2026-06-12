// 관리자 AI 비서의 읽기 전용 계산(순수 함수). 라우트가 Supabase 행을 넘기면 답 데이터를 만든다.
//   admin 화면의 집계 규칙(확정 상태 + 일시정지 제외, 정기 요일분 + 단품 ship_date)과 동일하게 맞춘다.
//   순수 함수라 단위 테스트로 보장한다(AI 가 숫자를 지어내지 않게, 사실은 여기서만 계산).
//   ★ 배송 명단·생산수요는 관리자 화면과 동일한 권위 로스터(buildRosterForDate)에 위임한다 —
//     시작 전(started_at)·회차소진(종료일)·정지·해지·첫배송 공휴일 시프트를 일관 반영(과다집계 방지).
import { kstYmd } from "../kst";
import { buildRosterForDate } from "../delivery-roster";
import type { DispatchSlotInfo } from "../dispatch-schedule";

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
  block_weeks?: number | null; // 구독 총 회차(회차소진 판정). 라우트는 select("*")로 채운다.
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
  // 권위 로스터 게이팅용(라우트 select("*") 로 채워짐). 없으면 보수적 기본값.
  started_at?: string | null;
  first_ship_date?: string | null;
  paused_at?: string | null;
  paused_days?: number;
  extended_weeks?: number | null;
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

// 해지된 구독의 주문 id — 배송 명단·생산수요에서 제외(admin 로스터와 동일 규칙).
//   주문 상태는 '입금확인'으로 남아 confirmed 에 들어오므로 별도 제외가 필요하다.
export function canceledOrderIds(slots: SlotLite[]): Set<string> {
  return new Set(
    slots.filter((s) => s.status === "해지" && s.order_id).map((s) => s.order_id as string)
  );
}

export type RosterRow = {
  kind: "정기" | "단품";
  name: string;
  phone: string;
  address: string;
  products: string;
  status: string;
};

// SlotLite[] → 주문별 DispatchSlotInfo(권위 로스터 게이팅 입력). 원주문 슬롯만 매핑한다.
//   누락 필드는 보수적 기본값(미상은 buildRosterForDate 가 포함 쪽으로 처리).
export function slotInfoByOrder(slots: SlotLite[]): Map<string, DispatchSlotInfo> {
  const m = new Map<string, DispatchSlotInfo>();
  for (const s of slots) {
    if (!s.order_id) continue;
    m.set(s.order_id, {
      status: s.status,
      started_at: s.started_at ?? null,
      first_ship_date: s.first_ship_date ?? null,
      paused: s.paused,
      paused_at: s.paused_at ?? null,
      paused_days: s.paused_days ?? 0,
      extended_weeks: s.extended_weeks ?? null,
    });
  }
  return m;
}

// 권위 로스터(buildRosterForDate)에 위임해 한 날짜의 배송 건을 산출한다.
//   단품 item 의 delivery_day(null)는 'mon' 으로 보정 — order_type 가드로 정기에 안 섞이고
//   단품은 ship_date 로 매칭되므로 안전하다. 연장주문은 슬롯이 없어 보수적 포함(폴백).
function rosterEntriesForDate(
  d: string,
  orders: OrderLite[],
  items: ItemLite[],
  confirmed: Set<string>,
  paused: Set<string>,
  slotByOrder: Map<string, DispatchSlotInfo>
) {
  return buildRosterForDate({
    dateISO: d,
    items: items.map((it) => ({ ...it, delivery_day: (it.delivery_day ?? "mon") as DeliveryDay })),
    orderById: new Map(orders.map((o) => [o.id, { ...o, block_weeks: o.block_weeks ?? 0 }])),
    slotByOrder,
    confirmedOrderIds: confirmed,
    pausedOrderIds: paused,
  });
}

// 한 날짜의 배송 명단(정기 요일분 + 단품 ship_date), 권위 로스터 규칙(시작·소진·정지·해지·공휴일 시프트).
export function rosterForDate(
  d: string,
  orders: OrderLite[],
  items: ItemLite[],
  confirmed: Set<string>,
  paused: Set<string>,
  slotByOrder: Map<string, DispatchSlotInfo> = new Map()
): RosterRow[] {
  return rosterEntriesForDate(d, orders, items, confirmed, paused, slotByOrder).map((e) => ({
    kind: e.kind,
    name: e.order.ship_name,
    phone: e.order.ship_phone,
    address: `(${e.order.ship_postcode ?? ""}) ${e.order.ship_address} ${e.order.ship_address_detail ?? ""}`.trim(),
    products: e.items.map((it) => `${it.product_name} ${it.volume}×${it.qty}`).join(", "),
    status: e.order.status,
  }));
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
  const slotByOrder = slotInfoByOrder(slots);
  return enumerateDates(fromISO, toISO)
    .map((d) => ({
      date: d,
      weekday: weekdayOf(d),
      rows: rosterForDate(d, orders, items, confirmed, paused, slotByOrder),
    }))
    .filter((day) => day.rows.length > 0);
}

// 생산 수요(기간 전체 제품별 합계). 배송 명단과 동일 SSOT(buildRosterForDate)에서 집계.
export function productionDemand(
  orders: OrderLite[],
  items: ItemLite[],
  slots: SlotLite[],
  fromISO: string,
  toISO: string
): { dates: string[]; total: Record<string, number>; byDate: { date: string; total: Record<string, number> }[] } {
  const confirmed = confirmedIds(orders);
  const paused = pausedOrderIds(slots);
  const slotByOrder = slotInfoByOrder(slots);
  const dates = enumerateDates(fromISO, toISO);
  const total: Record<string, number> = {};
  const byDate = dates.map((d) => {
    const dayTotal: Record<string, number> = {};
    for (const e of rosterEntriesForDate(d, orders, items, confirmed, paused, slotByOrder)) {
      for (const it of e.items) {
        const key = `${it.product_name} ${it.volume}`;
        dayTotal[key] = (dayTotal[key] ?? 0) + it.qty;
        total[key] = (total[key] ?? 0) + it.qty;
      }
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
