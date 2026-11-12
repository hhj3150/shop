// 페이지별 '내용이 마지막으로 바뀐 날'(YYYY-MM-DD) — sitemap.xml 의 <lastmod> 단일 출처.
//
//   [왜] 예전 sitemap 은 모든 주소에 '빌드 시각'을 찍었다. 구글은 정확하지 않은 lastmod 를
//        무시하고, Bing 은 lastmod 를 재수집 순서의 핵심 신호로 쓴다(ChatGPT 검색의 바탕 색인).
//        IndexNow 예약 함수(netlify/functions/indexnow.mts)도 이 날짜로 '최근 바뀐 주소'만 골라 보낸다.
//   ★ 손님이 읽는 내용(본문·가격·정책·구조화데이터)을 바꾸면 그 페이지 날짜를 '배포되는 날'로 고친다.
//     매일 IndexNow 예약 함수는 lastmod 가 '어제'인 주소만 보낸다 — 늦게 배포됐으면 수동 제출(운영가이드 §2).
//     DB(product_catalog)에서 가격을 바꿨을 때도 해당 제품 날짜를 올린다.
//     오타·디자인만 바꿨으면 고치지 않는다. 약관류는 화면의 '시행일'과 같은 값을 쓴다.
//   ★ 새 공개 페이지·제품을 만들면 여기에 날짜를 더한다(lib/seo/sitemap.test.ts 가 빠진 것을 잡는다).
//     해설 페이지 날짜는 lib/seo/learn.ts 의 updated, 목장 소식은 DB updated_at 이 출처다.

/** 약관·안내 '시행일' — 화면(LegalLayout updated)과 sitemap 이 같은 값을 쓴다. */
export const LEGAL_UPDATED = {
  guide: "2026-11-12",
  // 이용약관 현행 시행일. 개정 시행일은 lib/terms-revision.ts(시행일이 되면 /terms 가 저절로 바뀐다).
  terms: "2026-06-06",
  privacy: "2026-11-12",
} as const;

/** 고정 경로 → 마지막 내용 변경일. */
export const PAGE_UPDATED: Record<string, string> = {
  "/": "2026-11-12",
  "/story": "2026-11-12",
  "/faq": "2026-11-12",
  "/signup": "2026-11-11",
  "/order-once": "2026-11-11",
  "/guide": LEGAL_UPDATED.guide,
  // 개정 공지를 게시한 날(시행 전 공지도 내용 변경이다).
  "/terms": "2026-11-12",
  "/privacy": LEGAL_UPDATED.privacy,
};

/** 제품 id → 마지막 내용 변경일(가격·표시사항·설명). */
export const PRODUCT_UPDATED: Record<string, string> = {
  "milk-180": "2026-11-12",
  "milk-750": "2026-11-12",
  "yogurt-180": "2026-11-12",
  "yogurt-500": "2026-11-12",
  "aftermilk-1l": "2026-11-11",
};
