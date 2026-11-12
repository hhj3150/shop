# SEO·GEO 운영 가이드 (shop.a2jerseymilk.com)

> 2026-11-12 세팅. 검색(구글·네이버·Bing·다음)과 AI 답변(ChatGPT·Claude·Perplexity·Gemini·네이버 AI 브리핑)에
> 송영신목장이 **정확한 사실로** 노출·인용되도록 한 설정과, 코드 밖에서 사람이 해야 할 일을 정리한다.

## 1. 무엇이 어디에 있나 (단일 출처)

| 영역 | 파일 | 비고 |
|---|---|---|
| 페이지 제목·설명 문구 | `lib/seo/copy.ts` | 숫자는 `lib/products.ts`·`lib/regions.ts` 에서만. 금지어는 `lib/seo/claims.test.ts` 가 검사 |
| 메타데이터 헬퍼 | `lib/seo/meta.ts` | `pageMetadata`(공개), `privateMetadata`(noindex), `searchVerification`(소유확인 env) |
| 구조화데이터(JSON-LD) | `lib/seo/schema.ts` | Organization·WebSite·Store·Product·BreadcrumbList·AboutPage·FAQPage, `@id` 로 연결 |
| robots.txt | `lib/seo/robots.ts` → `app/robots.txt/route.ts` | AI 답변·학습 봇 명시 허용, `/admin`·`/api` 만 차단, 다음 인증줄 env |
| sitemap.xml | `lib/seo/sitemap.ts` + `lib/seo/lastmod.ts` | **실제 내용 변경일**. 이미지 항목은 넣지 않음(Next 직렬화 순서가 XSD 위반 — 제품 사진은 구조화데이터가 알림) |
| llms.txt / llms-full.txt | `lib/seo/llms.ts` → `app/llms*.txt/route.ts` | SSOT 에서 생성(가격은 DB), 하루 1회 갱신. llmstxt.org 형식(H2 아래는 링크만). `public/llms.txt` 를 다시 만들지 말 것(라우트를 가림) |
| 검색·AI 문구의 가격 | `lib/seo/live-catalog.ts` | product_catalog(DB) 가격 — 메타 설명·Product 구조화데이터·/faq 가격 문답·llms 가 같은 값. 조회 실패 시 정적 값 |
| 문답 | `lib/seo/faq.ts` | `FAQ_ITEMS`(홈·도우미·/faq 공용) + `moreFaqItems()`(/faq 전용) |
| 제품 공유 카드 | `app/products/[id]/opengraph-image.tsx` | 1200×630 PNG, 빌드 때 생성(카카오톡은 WEBP 를 못 읽는다) |
| IndexNow | `lib/seo/indexnow.ts`, `public/<키>.txt`, `netlify/functions/indexnow.mts`, `scripts/indexnow.mjs` | Bing·네이버 등에 변경 알림(공용 엔드포인트 1곳 → 참여 엔진에 공유) |
| 비공개 noindex | `app/{login,account,checkout,orders,admin,forgot-password,reset-password}/layout.tsx` | robots.txt 로 막지 않는다(막으면 noindex 를 못 읽음) |

## 2. 평소 운영 규칙

1. **손님이 읽는 내용(본문·가격·정책·구조화데이터)을 바꾸면** `lib/seo/lastmod.ts` 의 그 페이지 날짜를 **배포되는 날**로 고친다.
   → 다음 날 06:20 KST 에 IndexNow 예약 함수가 lastmod 가 '어제'인 주소만 Bing·네이버에 한 번 알린다(중복 없음).
   → PR 이 늦게 머지돼 lastmod 보다 늦게 배포됐다면, 배포 후 `node scripts/indexnow.mjs --since <그 날짜>` 를 한 번 돌린다.
   → 관리자 화면에서 DB 가격을 바꿨을 때도 해당 제품 날짜를 올린다(검색 문구는 1시간 안에 DB 가격으로 바뀐다).
2. **새 공개 페이지·제품**을 만들면: `lastmod.ts` 에 날짜, `lib/seo/sitemap.ts` 의 `SITEMAP_PAGES`(페이지), 메타데이터는 `pageMetadata` 로.
   제품 누끼 PNG 는 `public/products/<id>.png` 규칙(공유 카드가 읽는다).
3. **제목은 자주 바꾸지 않는다**(네이버 불이익). 제목 안에서 같은 낱말을 되풀이하지 않는다(테스트가 잡는다).
4. 검색·AI 문구에 쓰지 않는 말: `건초만`·`풀만`(사실과 다름), `방목`, `일반 우유`·`~보다`(비교), 소화·건강 효능, 근거 없는 `최초/최고/유일`.
   인증은 **농장 인증**으로만(‘동물복지 우유’ ✕ → ‘동물복지축산농장 인증 목장’ ○).
5. **하지 않는 것**(구글 스팸 정책): AI 봇에게만 다른 화면 보여 주기(클로킹), 숨김 글자, 가짜 후기·별점, 키워드 반복용 대량 페이지.

## 3. 사람이 콘솔에서 해야 할 일 (코드로 못 하는 것)

| 순서 | 할 일 | 방법 | 완료 확인 |
|---|---|---|---|
| ① | **구글 서치콘솔** 소유확인 | 설정 → 소유권 확인 → HTML 태그의 `content` 값을 Netlify 환경변수 `GOOGLE_SITE_VERIFICATION` 에 넣고 재배포(DNS 방식으로 이미 확인돼 있으면 생략) | 서치콘솔 '소유권 확인됨' |
| ② | 구글 **sitemap 제출** | Sitemaps → `https://shop.a2jerseymilk.com/sitemap.xml` | 상태 '성공' |
| ③ | **Bing 웹마스터 도구** 등록 | '서치콘솔에서 가져오기'가 가장 빠름. 또는 `BING_SITE_VERIFICATION` 환경변수 | 소유확인 + sitemap '성공'. 월 1회 'AI Performance' 리포트 확인 |
| ④ | **네이버 서치어드바이저** | (소유확인은 HTML 파일로 이미 됨) 요청 → 사이트맵 제출 → 웹페이지 수집 요청(홈·제품 4·/faq·/story) | 1주 뒤 리포트 → 사이트 진단 |
| ⑤ | **다음 웹마스터도구** | 사이트 등록 → PIN 발급 → `DAUM_WEBMASTER_VERIFICATION=hash:code` 환경변수 → 재배포 → 인증 → 사이트맵 등록 | robots.txt 마지막 줄에 `#DaumWebMasterTool:…` |
| ⑥ | **IndexNow 첫 전체 제출** | 배포 후 1회: `node scripts/indexnow.mjs --all` (먼저 `--dry-run` 으로 확인) | 응답 200/202 |
| ⑦ | **카카오 공유 캐시 초기화** | developers.kakao.com/tool/debugger/sharing 에서 홈·제품 4·/faq URL 각각 초기화 | 카톡에 링크를 보내 새 카드 확인 |
| ⑧ | 구조화데이터 검증 | search.google.com/test/rich-results 로 제품 1개·홈·/faq | 오류 0 (경고는 검토) |
| ⑨ | **Google Business Profile·네이버 스마트플레이스** | '송영신목장' 판매장 등록. 주소·전화·시간을 이 사이트와 **똑같이**(판매장 월–금 09:00–18:00) | AI 지도·로컬 답변 노출의 바탕 |
| ⑩ | (선택) Google Merchant Center | 무료 등록(한국 지원). 상품 데이터는 '웹사이트 구조화데이터' 자동 수집. 배송·반품 정책 입력 | 무료 등록 승인 |

## 4. 사장님 결정이 필요한 항목 (코드는 그대로 두었다)

검색·AI 는 사이트의 문장을 그대로 인용한다. 아래는 페이지끼리 말이 다르거나 근거가 없어 **AI 가 틀린 답을 할 수 있는** 곳이다.

1. **판매 대상** — `/guide`·약관 제4조 "회원에게만 판매" ↔ FAQ·`/order-once` "회원이 아니어도 단품 구매 가능". 실제 운영(단품 비회원 판매)에 맞게 안내·약관을 고칠지(약관은 개정 절차 필요).
2. **정기구독 해지** — `/guide`·고객 도우미 "최소 4회 이후" ↔ 약관 제7조 "언제든 해지, 미배송분 환불".
3. **'하루 500리터'** — 홈(WhyBand)에 있으나 SSOT·근거 자료가 없다. 이번 llms.txt 에는 넣지 않았다. 근거가 있으면 상수로 올리고 다시 넣는다.
4. **'국내 유일 A2 저지 목장'** — 상세 페이지에 범위를 밝혀 쓰고 있다(2026-11-11 결정). 표시광고법상 최상급 표현은 실증 책임이 있어, **검색 설명·llms.txt 에는 넣지 않았다.** 근거 자료(기관 확인서 등)를 보관하면 다시 넣을 수 있다.
5. **FAQ 의 '일반 우유'·"속이 불편할까요?" 문항** — 카피 가이드 금지어(비교)이고, FAQ 는 /faq 구조화데이터로 AI 에 그대로 간다. 소화 관련 질문은 효능으로 읽힐 소지가 있어 표시광고 검토를 권한다.
6. **신선도 표현** — FAQ "다음 날 발송" ↔ 화면 "다음 날 도착"·"그날 새벽 짠 한 병이 곧장 문 앞에". 실제 일정 하나로.
7. **영문 표준명** — Song Young Shin Farm / Song Yeong Shin Farm(푸터) / Song Young Shin Dairy Farm(브랜드 홈). 하나로 정하면 `lib/site.ts` `BRAND.alternateNames` 맨 앞과 푸터를 맞춘다.
8. **브랜드 홈(Wix) 정보 불일치** — 주소(역전길)·전화·사업자번호·문구('대한민국 0.1%', '최상급')가 쇼핑몰과 다르다. 같은 '송영신목장'으로 묶이려면 맞춰야 한다(Wix 관리자 권한 필요).
9. **고객 도우미 지식**(`lib/assistant/knowledge.ts`) — '건초만', '자연 방목'(인증서상 자유방목 '부'), 'EU 기준 그대로' 등. 검색 노출 표면은 아니지만 손님에게 하는 말이므로 같은 기준으로 고칠 것을 권한다.
10. **우편번호** — 구조화데이터 주소에 넣지 않았다(추정 금지). 확인되면 `lib/site.ts` `ADDRESS_PARTS` 에 더한다.

## 5. 다음 단계 (2차, 콘텐츠)

- **목장 소식 개별 주소 + RSS** — 지금 소식(NewsBand)은 브라우저에서만 불러와 네이버·AI 봇이 못 읽고, 글마다 주소가 없어 RSS 를 낼 수 없다.
  `/story/news/[id]` 서버 렌더 + BlogPosting 구조화데이터 + `/rss.xml` → 네이버 서치어드바이저 RSS 제출.
- **해설 페이지** — 'a2 우유 뜻/차이', '저지우유', '헤이밀크(건초우유)', '동물복지·저탄소 인증 목장'에 답하는 서버 렌더 페이지(질문형 소제목, 첫 문단에 결론, 출처·연도).
- **/order-once 서버 렌더 소개** — 지금은 첫 HTML 이 '불러오는 중…'뿐이다.
- **네이버 블로그(78redmoon)** — 같은 주제의 1차 경험 글 + 쇼핑몰 링크(네이버 AI 브리핑 출처의 다수가 블로그).
- **측정** — 월 1회 ChatGPT·Perplexity·Gemini·네이버 AI 브리핑에 'A2 우유 정기배송', '저지 우유', '송영신목장' 등 20개 질의 → 언급·인용 기록. 서치콘솔·Bing AI Performance 리포트.
