// 페이지별 '내용이 마지막으로 바뀐 날'(YYYY-MM-DD) — sitemap.xml 의 <lastmod> 단일 출처.
//
//   [왜] 예전 sitemap 은 모든 주소에 '빌드 시각'을 찍었다. 구글은 정확하지 않은 lastmod 를
//        무시하고, Bing 은 lastmod 를 재수집 순서의 핵심 신호로 쓴다(ChatGPT 검색의 바탕 색인).
//        IndexNow 예약 함수(netlify/functions/indexnow.mts)도 이 날짜로 '최근 바뀐 주소'만 골라 보낸다.
//   ★ 손님이 읽는 내용(본문·가격·정책)을 바꾸면 그 페이지 날짜를 그날로 고친다.
//     오타·디자인만 바꿨으면 고치지 않는다. 약관류는 화면의 '시행일'과 같은 값을 쓴다.
//   ★ 새 공개 페이지·제품을 만들면 여기에 날짜를 더한다(lib/seo/sitemap.test.ts 가 빠진 것을 잡는다).

/** 약관·안내 '시행일' — 화면(LegalLayout updated)과 sitemap 이 같은 값을 쓴다. */
export const LEGAL_UPDATED = {
  guide: "2026-05-30",
  terms: "2026-06-06",
  privacy: "2026-06-06",
} as const;

/** 고정 경로 → 마지막 내용 변경일. */
export const PAGE_UPDATED: Record<string, string> = {
  "/": "2026-11-11",
  "/story": "2026-11-12",
  "/faq": "2026-11-12",
  "/signup": "2026-11-11",
  "/order-once": "2026-11-11",
  "/guide": LEGAL_UPDATED.guide,
  "/terms": LEGAL_UPDATED.terms,
  "/privacy": LEGAL_UPDATED.privacy,
};

/** 제품 id → 마지막 내용 변경일(가격·표시사항·설명). */
export const PRODUCT_UPDATED: Record<string, string> = {
  "milk-180": "2026-11-11",
  "milk-750": "2026-11-11",
  "yogurt-180": "2026-11-11",
  "yogurt-500": "2026-11-11",
  "aftermilk-1l": "2026-11-11",
};
