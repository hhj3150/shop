// 연장 안내를 언제 띄울지 — 손님 화면의 단일 판정.
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
