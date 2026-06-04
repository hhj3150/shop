// PayAction 등록 실패코드(register 라우트/registerOrder 반환)를 관리자용 한국어 안내로 변환.
//   React 비의존 순수 함수 — 단위 테스트 대상.
//
// 목적: 관리자가 '재등록' 버튼을 눌렀을 때 실패 사유를 사람이 읽을 수 있게 보여줘,
//       환경변수 문제인지(not_configured) 키 문제인지(http_401) 즉시 진단하도록 돕는다.

const KNOWN: Record<string, string> = {
  not_configured: "서버 환경변수 미설정 또는 재배포 필요 (PAYACTION_*·CONFIRM_PAYMENT_SECRET 확인 후 재배포)",
  order_not_found: "주문을 찾을 수 없음",
  lookup_failed: "주문 조회 실패 (Supabase·시크릿 확인)",
  not_pending: "이미 입금확인·취소된 주문이라 재등록 불필요",
  missing_depositor_name: "입금자명이 비어 자동매칭 불가 — 입금자명 입력 후 재등록 필요",
  missing_billing_name: "입금자명이 비어 자동매칭 불가 — 입금자명 입력 후 재등록 필요",
  invalid_order_number: "주문번호 형식 오류 (22자 이하 확인)",
  invalid_amount: "주문 금액 오류",
  invalid_body: "요청 형식 오류",
  missing_order_no: "주문번호 누락",
  request_failed: "PayAction 서버 연결 실패 (네트워크·주소 확인)",
};

// 사람이 읽을 수 있는 한국어 안내로 변환. 매핑에 없으면 원문을 보존한다(디버깅 단서 유지).
export function payActionReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "등록 실패 (사유 불명)";

  if (KNOWN[reason]) return KNOWN[reason];

  // PayAction HTTP 상태코드 계열: 인증(401/403) vs 서버(5xx) vs 기타 요청거부(4xx).
  if (reason === "http_401" || reason === "http_403") {
    return "PayAction 인증 실패 — API 키 불일치 (재발급한 키를 환경변수에 반영했는지 확인)";
  }
  if (reason.startsWith("http_5")) {
    return "PayAction 서버 오류 — 잠시 후 다시 시도해 주세요";
  }
  if (reason.startsWith("http_4")) {
    return `PayAction 요청 거부 (${reason})`;
  }

  // 알 수 없는 사유(예: PayAction 응답 메시지 원문)는 그대로 노출한다.
  return reason;
}
