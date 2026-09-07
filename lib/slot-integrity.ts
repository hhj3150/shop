// 구독 슬롯 무결성 판정(순수) — 관리자 '데이터 점검'의 단일 진실 소스.
//
//   손님 화면과 관리자 화면은 서로 다른 표를 본다. 두 표가 갈리는 순간 신뢰가 깨진다
//   ('다음 발송 9/7' 이라고 안내해 놓고 우유는 안 가는 식). 갈릴 수 있는 지점을 여기 모아
//   판정 규칙을 하나로 두고, 화면은 결과만 보여 준다.
//
//   ★ 결제 회차(총 회차)는 언제나 '확정된 블록 체인'(원주문 + 확정 연장주문)의 합이다.
//     slots.extended_weeks 는 늘기만 하고 줄지 않아서, 입금확인했던 연장주문을 나중에
//     '취소'로 되돌리면 회차가 남는다 — 손님·서버 환불(cancel_subscription)·배송 명단이
//     제각각 다른 총 회차를 말하게 된다. 블록 체인은 취소 즉시 줄어든다.
import { computeSchedule } from "./subscription-schedule";
import { totalWeeks as blockTotalWeeks, type RawBlock } from "./subscription-timeline";

export type IntegritySlotFields = {
  id: number;
  order_id: string | null;
  status: string;
  started_at: string | null;
  first_ship_date: string | null;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
};

export type IntegrityOrderFields = {
  id: string;
  status: string;
  block_weeks: number | null;
};

// 이 슬롯이 손님에게서 받은 총 회차. 블록 체인이 있으면 그 합, 없으면(레거시) 옛 값.
export function paidRoundsForSlot<O extends IntegrityOrderFields>(
  slot: IntegritySlotFields,
  orderById: ReadonlyMap<string, O>,
  blocksBySlot?: ReadonlyMap<number, RawBlock[]>
): number {
  const blocks = blocksBySlot?.get(slot.id);
  if (blocks && blocks.length > 0) return blockTotalWeeks(blocks);
  const base = slot.order_id ? (orderById.get(slot.order_id)?.block_weeks ?? 0) : 0;
  return base + (slot.extended_weeks ?? 0);
}

// (1) 주문은 '취소'인데 구독 슬롯이 살아 있다.
//   손님 마이페이지에는 '활성' 구독과 다음 발송일이 뜨는데, 배송 명단에는 없어 우유가 안 간다.
//   요일 정원도 계속 차지해 신규 신청을 막는다. → admin_cancel_order 로 정리한다.
export function cancelledButActiveSlots<
  S extends IntegritySlotFields,
  O extends IntegrityOrderFields,
>(slots: readonly S[], orderById: ReadonlyMap<string, O>): S[] {
  return slots.filter(
    (s) =>
      s.status !== "해지" &&
      !!s.order_id &&
      orderById.get(s.order_id)?.status === "취소"
  );
}

// (2) 결제한 회차만큼 이미 나갔는데 아직 활성인 구독 → 다음 회차가 나가면 과배송이다.
//   배송 시트가 '발송금지'로 막지만, 원인(연장 미처리·회차 어긋남)은 사람이 판단해야 한다.
export function roundsUsedUpSlots<
  S extends IntegritySlotFields,
  O extends IntegrityOrderFields,
>(
  slots: readonly S[],
  orderById: ReadonlyMap<string, O>,
  shippedBySlot: ReadonlyMap<number, number>,
  blocksBySlot?: ReadonlyMap<number, RawBlock[]>
): { slot: S; paid: number; shipped: number }[] {
  return slots
    .filter((s) => s.status === "활성")
    .map((s) => ({
      slot: s,
      paid: paidRoundsForSlot(s, orderById, blocksBySlot),
      shipped: shippedBySlot.get(s.id) ?? 0,
    }))
    .filter((x) => x.paid > 0 && x.shipped >= x.paid);
}

// 출고 기록 누락으로 볼 최소 차이. 1회는 '오늘·이번 주 분을 아직 출고 처리하지 않음'일 수
//   있어 정상 운영에서도 흔하다. 2회 이상 벌어지면 기록이 실제를 못 따라가고 있는 것이다.
export const SHIPMENT_GAP_THRESHOLD = 2;

// (3) 출고 기록(shipment_log)이 실제 발송을 못 따라가는 구독.
//   ★ 왜 중요한가: 과배송 최종 방어선(배송 시트의 '발송금지')이 바로 이 기록을 센다.
//     기록이 비어 있으면 방어선이 작동하지 않는다 — 12회를 이미 보냈는데 기록이 0회면
//     시트는 계속 '보내도 된다'고 말한다. 손님 마이페이지의 '배송 현황'도 이 기록으로 그려서,
//     받은 우유가 화면에 없으면 손님이 먼저 이상을 느낀다.
export function shipmentGapSlots<
  S extends IntegritySlotFields,
  O extends IntegrityOrderFields,
>(
  slots: readonly S[],
  orderById: ReadonlyMap<string, O>,
  shippedBySlot: ReadonlyMap<number, number>,
  todayISO: string,
  blocksBySlot?: ReadonlyMap<number, RawBlock[]>,
  threshold: number = SHIPMENT_GAP_THRESHOLD
): { slot: S; expected: number; shipped: number; gap: number }[] {
  const now = new Date(`${todayISO}T00:00:00`);
  return slots
    .filter((s) => s.status === "활성" && s.started_at != null)
    .map((s) => {
      const total = paidRoundsForSlot(s, orderById, blocksBySlot);
      const sch = computeSchedule(
        {
          startedAt: s.started_at,
          firstShipDate: s.first_ship_date,
          totalWeeks: total,
          paused: s.paused,
          pausedAt: s.paused_at,
          pausedDays: s.paused_days ?? 0,
        },
        now
      );
      const shipped = shippedBySlot.get(s.id) ?? 0;
      return { slot: s, expected: sch.delivered, shipped, gap: sch.delivered - shipped };
    })
    .filter((x) => x.gap >= threshold)
    .sort((a, b) => b.gap - a.gap || a.slot.id - b.slot.id);
}
