// 관리자 회원 개별 문자 — 순수 로직(프리셋 치환). React/네트워크 비의존 → 단위 테스트 대상.
//   발송·수신자 검증은 기존 BroadcastPanel + /api/broadcast(Solapi)가 담당. 여기선 본문 프리셋만.

// 자주 쓰는 문자 프리셋. {이름}은 fillPreset 에서 회원 이름으로 치환.
//   순서가 곧 화면 노출 순서다.
export const SMS_PRESETS: { key: string; label: string; body: string }[] = [
  {
    key: "order_incomplete",
    label: "주문 미완료 안내",
    body:
      "[송영신목장] {이름}님, 가입 감사합니다. 아직 주문이 완료되지 않았어요. " +
      "주문 페이지에서 '구매하기'를 누르면 입금 계좌가 안내됩니다. 도움 필요하시면 회신해 주세요.",
  },
  {
    key: "payment_pending",
    label: "입금 안내",
    body:
      "[송영신목장] {이름}님, 주문 입금이 아직 확인되지 않았습니다. " +
      "안내된 금액·계좌로 입금 부탁드립니다.",
  },
];

// 프리셋 본문의 {이름}을 회원 이름으로 치환한다. 이름이 비면 '고객'. 없는 키는 빈 문자열.
export function fillPreset(key: string, memberName: string): string {
  const preset = SMS_PRESETS.find((p) => p.key === key);
  if (!preset) return "";
  const name = memberName.trim() || "고객";
  return preset.body.split("{이름}").join(name);
}
