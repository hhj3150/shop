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
