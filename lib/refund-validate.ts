// 환불·교환 접수 금액 검증 — 오타로 인한 과다 환불/금액 누락을 사전에 잡는다.
//   접수 자체를 막지 않고(예외 케이스 허용) 확인을 받기 위한 경고 코드를 반환한다.
export type RefundWarning = "EXCEEDS_TOTAL" | "ZERO_REFUND";

export const REFUND_WARNING_LABEL: Record<RefundWarning, string> = {
  EXCEEDS_TOTAL: "환불금액이 주문금액보다 큽니다.",
  ZERO_REFUND: "환불 접수인데 환불금액이 0원입니다.",
};

// 접수 금액에 대한 경고 목록. 환불 유형의 0원, 주문금액 초과를 잡는다.
//   amount 가 숫자가 아니면 0으로 본다.
export function refundWarnings(params: {
  type: "환불" | "교환";
  amount: number;
  orderTotal: number;
}): RefundWarning[] {
  const amount = Number.isFinite(params.amount) ? params.amount : 0;
  const warnings: RefundWarning[] = [];
  if (params.type === "환불" && amount <= 0) warnings.push("ZERO_REFUND");
  if (amount > params.orderTotal) warnings.push("EXCEEDS_TOTAL");
  return warnings;
}
