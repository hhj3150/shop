// 무통장입금 전환을 돕는 순수 헬퍼.
// 스마트폰 은행 앱으로 송금할 때 가장 흔한 실수는 '금액 오기'다.
// 정확한 금액을 숫자만으로 제공해, 사용자가 그대로 붙여넣어 오기를 막는다.
export function depositAmountDigits(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return String(Math.round(amount));
}
