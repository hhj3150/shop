// 연장을 지금 권할 수 있는가 — 손님 화면의 단일 판정.
//
//   연장하는 길이 둘이다: 마이페이지의 '구독 연장' 버튼, 그리고 장바구니에 담고 결제로 가면
//   같은 요일 활성 구독이 있을 때 자동으로 연장으로 접수되는 길(checkout 의 renewalMode).
//   서버(request_renewal)는 하나지만 화면이 둘이라, 같은 상황에 다른 말을 하기 쉽다.
//   두 화면이 함께 쓰는 판정과 문구를 여기 모은다.
//
//   [왜 순수 함수인가] 이 판정이 화면 조건식에 박혀 있으면, '언제부터 안내하나'를 바꿀 때마다
//     JSX 를 헤집어야 하고 테스트도 못 한다. 규칙을 여기 한 곳에 두고 화면은 결과만 쓴다.
//
//   [규칙] 남은 회차 3회 이하 + 이미 2회 이상 받음.
//     · 남은 3회 = 주 1회 배송이니 3주 전. 옛 기준(2회)은 2주 전이라 손님이 생각할
//       시간도, 목장이 자리를 다시 채울 시간도 모자랐다.
//     · '2회 이상 받음' 조건이 없으면 4주(4회) 구독은 1회만 받고 바로 연장 안내가 뜬다.
//       이제 막 시작한 분께 "곧 끝나요"라고 말하는 꼴이다.
//     · 회차를 다 쓴 구독(남은 0회)도 안내 대상이다 — 그때가 가장 연장이 필요한 시점이다.
//
//   ※ 정지 중에는 띄우지 않는다. 쉬는 중인 분께 재촉이 된다.

export const RENEWAL_PROMPT_REMAINING = 3;
export const RENEWAL_PROMPT_MIN_DELIVERED = 2;

export type RenewalPromptInput = {
  started: boolean;
  paused: boolean;
  delivered: number;
  remaining: number;
};

export function shouldPromptRenewal(s: RenewalPromptInput): boolean {
  if (!s.started || s.paused) return false;
  return (
    s.remaining <= RENEWAL_PROMPT_REMAINING &&
    s.delivered >= RENEWAL_PROMPT_MIN_DELIVERED
  );
}


// ── 이미 접수된 연장이 있을 때 ────────────────────────────────────────────
//
//   서버(request_renewal)는 한 슬롯에 입금대기 연장주문이 있으면 새 신청을 거절한다.
//   중복 접수를 막는 옳은 가드지만, 두 화면이 이 상황을 서로 다르게 다루면 손님이 헤맨다.
//   · 마이페이지: 입금 안내 패널이 떠 있어 계좌·금액을 다시 볼 수 있다.
//   · 체크아웃: "연장으로 접수돼요"라고 끝까지 안내해 놓고 제출 순간에 막혔다 —
//     게다가 어디 가서 입금 안내를 보는지 말해 주지 않았다.
//   같은 상황에는 같은 말을 하고, 같은 곳(마이페이지 입금 안내)을 가리킨다.

export const PENDING_RENEWAL_TITLE = "이미 연장 신청이 접수돼 있어요";

// 입금 안내를 어디서 다시 보는가 — 연장을 어느 길로 신청했든 같은 곳을 가리킨다.
//   마이페이지 연장 패널, 체크아웃의 '이미 접수됨' 안내, 주문완료 화면이 모두 이 문장을 쓴다.
export const PENDING_RENEWAL_WHERE =
  "계좌와 금액은 마이페이지 > 정기구독의 '연장 입금 안내'에서 다시 보실 수 있어요.";

export const PENDING_RENEWAL_NOTICE =
  `입금이 확인되면 이어서 배송됩니다. ${PENDING_RENEWAL_WHERE} 구성을 바꾸시려면 거기서 신청을 취소하고 다시 고르시면 됩니다.`;

// 서버가 돌려준 중복 연장 거절인가. 문구가 바뀌어도 견디도록 핵심 낱말로 알아본다.
//   (알아보지 못하면 원문을 그대로 보여 준다 — 조용히 삼키는 것보다 낫다.)
export function isPendingRenewalError(message: string): boolean {
  return message.includes("연장 입금 대기");
}
