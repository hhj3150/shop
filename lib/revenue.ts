// 순매출 계산 — 환불·해지 차감 후 매출. UI·Supabase 의존 없는 순수 함수.
//   순매출 = 확정 총매출 − 구독해지 환불 − 완료 제품환불 (음수는 0으로 클램프).
//   설계: docs/superpowers/specs/2026-06-08-net-revenue-kpi-design.md

// 해지 환불 합산에 필요한 슬롯 최소 형태(subscription_slots 부분집합).
export type RefundSlotLite = {
  status: string;
  refund_amount?: number | null;
};

// 제품환불 합산에 필요한 order_returns 최소 형태.
export type ReturnLite = {
  type: string; // "환불" | "교환"
  status: string; // "접수" | "승인" | "완료" | "반려"
  amount?: number | null;
};

// 구독해지 환불 합계: status='해지' 슬롯의 refund_amount 합(남은 회차 환불액).
export function cancellationRefundTotal(slots: readonly RefundSlotLite[]): number {
  return slots
    .filter((s) => s.status === "해지")
    .reduce((sum, s) => sum + (s.refund_amount ?? 0), 0);
}

// 완료 제품환불 합계: type='환불' AND status='완료' 인 건의 amount 합.
//   교환은 매출 영향 없음, 미완료(접수·승인)·반려는 실제 송금 아님 → 제외.
export function completedReturnRefundTotal(returns: readonly ReturnLite[]): number {
  return returns
    .filter((r) => r.type === "환불" && r.status === "완료")
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
}

// 순매출: 총매출에서 차감, 음수면 0.
export function netRevenue(
  gross: number,
  cancelRefunds: number,
  returnRefunds: number
): number {
  return Math.max(0, gross - cancelRefunds - returnRefunds);
}
