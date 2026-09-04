import { describe, it, expect } from "vitest";
import { subscribeStartHref } from "./site";

// 상단 메뉴 '정기구독'과 히어로 필름 CTA 가 같은 곳으로 가야 한다.
//   과거 상단 메뉴는 '/#subscribe'(SubscriptionBand) 로 갔는데, 그 섹션은 정원·3단계를
//   설명하는 소개 배너이고 페이지 끝쪽(뉴스 밴드 뒤)에 있어 제품을 고를 수 없다.
//   손님이 "정기구독을 눌렀는데 엉뚱한 데로 간다"고 알려 왔다.
describe("subscribeStartHref — 정기구독 시작 지점", () => {
  it("비회원은 가입으로 — 제품부터 고르게 하면 체크아웃에서 막혀 되돌아 나온다", () => {
    expect(subscribeStartHref(false)).toBe("/signup");
  });

  it("회원은 제품 선택으로 — 여기서 '구독 신청' → 상세 → 장바구니 → 결제로 이어진다", () => {
    expect(subscribeStartHref(true)).toBe("/#products");
  });

  it("[회귀] 어느 경우에도 소개 배너(#subscribe)로 보내지 않는다", () => {
    for (const isMember of [true, false]) {
      expect(subscribeStartHref(isMember)).not.toBe("/#subscribe");
    }
  });
});
