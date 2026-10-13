// 배송일 변경(회차 1회 이동) — 순수 로직. I/O 없음.
//
//   정기구독 배송일은 요일 cadence(order_items.delivery_day + 공휴일·휴무 규칙)로만 계산한다.
//   "이번 주만 수요일에", "월요일 출고를 못 하게 됐다" 같은 변수가 생기면 그 한 회차만
//   다른 날로 옮긴다. 요일·앵커·정지일수·회차 수는 건드리지 않는다 — 그걸 흔들면 전 회차
//   일정과 환불 계산이 통째로 움직인다.
//
//   규칙(서버 RPC admin_reschedule_shipment 와 같다 — 화면은 미리 거르고 서버가 최종 판정):
//     · 새 날짜 ≠ 예정일, 이동 폭 ±6일 이내(7일 이상이면 앞뒤 회차와 같은 주에 겹친다)
//     · 새 날짜는 평일이고 발송 불가일(공휴일·목장 휴무)이 아니어야 한다
//     · 이미 출고된 회차는 옮길 수 없다(기록이 사실이다)
//   단품 주문은 orders.ship_date 를 바꾸면 된다 — 이 표를 쓰지 않는다.
import type { DeliveryDay } from "./cart";
import { isDispatchBlockedISO } from "./holidays";

// shipment_reschedules 한 행(로스터 입력 최소 필드).
export type ShipmentReschedule = {
  id?: number;
  order_id: string;
  delivery_day: DeliveryDay;
  from_date: string; // 원래 예정일(YYYY-MM-DD)
  to_date: string; // 실제로 보낼 날(YYYY-MM-DD)
  note?: string | null;
};

/** 이동 가능한 최대 폭(일). 이 값 이상이면 앞뒤 회차와 같은 주에 겹친다. */
export const RESCHEDULE_MAX_DAYS = 6;

/** 로스터 키 — (주문, 요일, 예정일). */
export function rescheduleKey(orderId: string, day: string, fromISO: string): string {
  return `${orderId}|${day}|${fromISO}`;
}

function dayDiff(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime();
  const b = new Date(`${bISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export type RescheduleCheck = { ok: true } | { ok: false; reason: string };

// 새 날짜가 규칙에 맞는가. 서버 RPC 와 같은 순서·같은 문구로 거른다(화면 선검증).
export function checkRescheduleTarget(fromISO: string, toISO: string): RescheduleCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toISO)) return { ok: false, reason: "날짜를 선택해 주세요." };
  const to = new Date(`${toISO}T00:00:00`);
  if (Number.isNaN(to.getTime())) return { ok: false, reason: "날짜를 선택해 주세요." };
  if (toISO === fromISO) return { ok: false, reason: "같은 날짜입니다." };
  if (Math.abs(dayDiff(fromISO, toISO)) > RESCHEDULE_MAX_DAYS) {
    return {
      ok: false,
      reason: `${RESCHEDULE_MAX_DAYS}일 이내로만 옮길 수 있습니다(앞뒤 회차와 겹칩니다). 더 미루려면 일시정지·건너뛰기를 쓰세요.`,
    };
  }
  const dow = to.getDay();
  if (dow === 0 || dow === 6) return { ok: false, reason: "주말에는 발송할 수 없습니다." };
  if (isDispatchBlockedISO(toISO)) {
    return { ok: false, reason: "그날은 공휴일·휴무일이라 발송할 수 없습니다." };
  }
  return { ok: true };
}

// 로스터가 쓰는 인덱스 — 예정일에서 빠질 키 / 특정 날짜에 들어올 (주문·요일 → 예정일).
export type RescheduleIndex = {
  movedAway: ReadonlySet<string>; // rescheduleKey(order, day, from)
  movedTo: ReadonlyMap<string, ReadonlyMap<string, string>>; // toISO → (`${order}|${day}` → fromISO)
};

export function indexReschedules(rows: readonly ShipmentReschedule[] | undefined): RescheduleIndex {
  const movedAway = new Set<string>();
  const movedTo = new Map<string, Map<string, string>>();
  for (const r of rows ?? []) {
    if (!r.order_id || !r.delivery_day || !r.from_date || !r.to_date) continue;
    movedAway.add(rescheduleKey(r.order_id, r.delivery_day, r.from_date));
    const m = movedTo.get(r.to_date) ?? new Map<string, string>();
    m.set(`${r.order_id}|${r.delivery_day}`, r.from_date);
    movedTo.set(r.to_date, m);
  }
  return { movedAway, movedTo };
}

/** 'YYYY-MM-DD' → 'M/D(요일)' (관리자 표시용). */
export function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}
