// 이 스토어프론트의 공개 기준 URL(메타데이터·구조화 데이터·공유 링크의 절대 URL 기준).
export const SITE_URL = "https://shop.a2jerseymilk.com";

// 기존 브랜드 공식 홈페이지(Wix). "목장 이야기"는 이 사이트로 연결한다.
export const BRAND_HOME = "https://www.a2jerseymilk.com";

// 안성팜랜드 Hey Hay Milk Café 안내 페이지.
export const CAFE_HOME = "https://www.a2jerseymilk.com/milkcafe";

// 무통장입금 계좌 (사이트 게재 목적의 공개 정보).
export const DEPOSIT = {
  bank: "농협",
  account: "351-1051-9755-13",
  holder: "농업회사법인(주)디투오",
} as const;

// 통신판매업 의무 표시정보 (텍스트만 게재).
export const BUSINESS = {
  company: "농업회사법인 주식회사 디투오",
  ceo: "송영신",
  bizNo: "266-88-01121",
  mailOrderNo: "제 2025-경기안성-0841 호",
  address: "경기도 안성시 미양면 미양로 466",
  tel: "031-674-3150",
  mobile: "010-6642-5042",
  email: "d2ovet3150@gmail.com",
  privacyManager: "송영신",
} as const;

// 목장 판매장 영업시간(방문 안내·VisitStore 공용 단일 출처).
export const FARM_HOURS = "월–금 09:00–18:00";

// 정기구독을 '시작하는' 자리 — 상단 메뉴의 '정기구독'과 히어로 필름 CTA 가 같은 곳으로 간다.
//   구독은 회원 전용이다(체크아웃이 비회원을 /login 으로 돌려보낸다). 그래서
//     · 비회원 → 가입(/signup). 제품부터 고르게 하면 체크아웃에서 막혀 되돌아 나온다.
//     · 회원   → 제품 선택(/#products). 여기서 '구독 신청' → 상세 → 장바구니 → 결제로 이어진다.
//   ★ '/#subscribe'(SubscriptionBand)는 정원·3단계를 설명하는 소개 배너이고 페이지 끝쪽에
//     있어 구매 동선이 아니다 — 상단 메뉴가 그리로 가면 손님이 제품을 못 찾는다(실사용 클레임).
export function subscribeStartHref(isMember: boolean): string {
  return isMember ? "/#products" : "/signup";
}
