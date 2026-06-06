// 관리자 배송 시트용 — 구독 슬롯 한 건의 배송 회차/제외 여부 산출.
// 진실의 단일 공급원은 computeSchedule(정지일수 반영). cancel_subscription RPC 의
// 경과주 규칙과 동일한 delivered 계산을 그대로 재사용한다.
import { computeSchedule } from "./subscription-schedule";

// 회차 계산에 필요한 슬롯 상태(관리자 SlotRow 의 부분집합).
export type DispatchSlotInfo = {
  status: string;
  started_at: string | null;
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

// shipISO 발송일 기준 회차와, 오늘(today) 기준 제외 여부를 함께 돌려준다.
//   - 제외: 슬롯 해지 / 일시정지 / 이미 총 회차를 다 배송(done) 한 경우.
//   - round: shipISO 까지 배송 완료 수(정지 반영). 시작 전이면 최소 1.
export function dispatchScheduleForSlot(
  slot: DispatchSlotInfo,
  blockWeeks: number,
  shipISO: string,
  today: Date = new Date()
): DispatchScheduleResult {
  const total = Math.max(0, blockWeeks + (slot.extended_weeks ?? 0));
  const input = {
    startedAt: slot.started_at,
    totalWeeks: total,
    paused: slot.paused,
    pausedAt: slot.paused_at,
    pausedDays: slot.paused_days,
  };

  const nowSchedule = computeSchedule(input, today);
  const excluded = slot.status === "해지" || slot.paused || nowSchedule.done;

  const atShip = computeSchedule(input, new Date(`${shipISO}T00:00:00`));
  const round = Math.max(1, atShip.delivered);
  const remaining = Math.max(0, total - round);

  return { excluded, round, total, remaining };
}
