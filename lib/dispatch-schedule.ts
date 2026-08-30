// 관리자 배송 시트용 — 구독 슬롯 한 건의 배송 회차/제외 여부 산출.
// 진실의 단일 공급원은 computeSchedule(정지일수 반영). cancel_subscription RPC 의
// 경과주 규칙과 동일한 delivered 계산을 그대로 재사용한다.
import { computeSchedule } from "./subscription-schedule";

// 회차 계산에 필요한 슬롯 상태(관리자 SlotRow 의 부분집합).
export type DispatchSlotInfo = {
  status: string;
  started_at: string | null;
  // 첫배송 공휴일 보정일(앵커가 공휴일이면 다음 영업일). 없으면 1회차 = started_at.
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
};

export type DispatchScheduleResult = {
  excluded: boolean; // 배송 큐에서 빼야 하는가(해지·정지·회차소진)
  round: number; // 이 발송일 기준 회차(1-base)
  total: number; // 총 회차 = block_weeks + extended_weeks
  remaining: number; // 남은 회차
};

// shipISO 발송일 기준 회차·제외 여부를 돌려준다(발송일만으로 결정 — 외부 시계 비의존).
//   - 제외: 슬롯 해지 / 일시정지 / 발송일이 마지막 배송일을 '지난' 경우(회차소진).
//     ★ 마지막 배송일 '당일'은 그날 실제로 발송하므로 제외하지 않는다(과소배송 방지).
//   - round: shipISO 까지 배송 완료 수(정지 반영). 시작 전이면 최소 1.
export function dispatchScheduleForSlot(
  slot: DispatchSlotInfo,
  blockWeeks: number,
  shipISO: string
): DispatchScheduleResult {
  const total = Math.max(0, blockWeeks + (slot.extended_weeks ?? 0));
  const input = {
    startedAt: slot.started_at,
    firstShipDate: slot.first_ship_date,
    totalWeeks: total,
    paused: slot.paused,
    pausedAt: slot.paused_at,
    pausedDays: slot.paused_days,
  };

  const atShip = computeSchedule(input, new Date(`${shipISO}T00:00:00`));
  const round = Math.max(1, atShip.delivered);
  const remaining = Math.max(0, total - round);

  // 회차소진: 발송일이 마지막 배송 예정일(endDate)을 지났는가. 당일(==)은 발송 대상.
  //   ISO(YYYY-MM-DD) 문자열 비교는 날짜 대소와 일치한다.
  const pastEnd = atShip.endDate != null && shipISO > atShip.endDate;
  // 시작 전: 발송일이 시작일(started_at)보다 이르면 아직 발송 대상이 아니다.
  //   started_at 을 미래로 지정(구독 시작일 연기)하면 그 전 발송을 막는다. 당일(==)은 발송.
  const beforeStart = slot.started_at != null && shipISO < slot.started_at;
  const excluded = slot.status === "해지" || slot.paused || pastEnd || beforeStart;

  return { excluded, round, total, remaining };
}

// shipISO 가 이 슬롯의 '실제 배송일 중 하루'인가(그 날짜에 회차가 놓이는가).
//   전날 대비 배송완료 수가 늘었으면 그 날이 곧 한 회차의 배송일이다.
//   한 주문에 슬롯이 여러 개(요일 2개 이상)일 때 '이번 출고가 어느 슬롯의 회차인지' 고르는 데 쓴다.
export function slotShipsOn(slot: DispatchSlotInfo, blockWeeks: number, shipISO: string): boolean {
  const [y, m, d] = shipISO.split("-").map(Number);
  if (!y || !m || !d) return false;
  const prev = new Date(y, m - 1, d - 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const prevISO = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}`;
  const at = dispatchScheduleForSlot(slot, blockWeeks, shipISO);
  const before = dispatchScheduleForSlot(slot, blockWeeks, prevISO);
  // round 는 최소 1로 클램프되므로 '시작일 당일'은 delivered 비교 대신 시작일 일치로 본다.
  if (slot.started_at === shipISO || slot.first_ship_date === shipISO) return true;
  return at.round > before.round;
}

// 한 주문에 묶인 슬롯 후보 중 이번 출고(shipISO)에 해당하는 슬롯을 고른다.
//   1순위: 그 날짜에 실제로 회차가 놓이는 슬롯. 2순위: 배송 대상(제외 아님)인 슬롯. 3순위: 첫 슬롯.
//   후보가 하나뿐이면 그대로 쓴다(대다수 주문).
export function pickSlotForShipDate<T extends { slot: DispatchSlotInfo; blockWeeks: number }>(
  candidates: readonly T[],
  shipISO: string
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.find((c) => slotShipsOn(c.slot, c.blockWeeks, shipISO));
  if (exact) return exact;
  const active = candidates.find(
    (c) => !dispatchScheduleForSlot(c.slot, c.blockWeeks, shipISO).excluded
  );
  return active ?? candidates[0];
}
