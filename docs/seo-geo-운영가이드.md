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
| 해설 페이지 | `lib/seo/learn.ts`(+`learn-schema.ts`) → `/learn`, `/learn/<slug>` | 첫 문단 = 결론, 출처 필수, `learn.test.ts` 가 금지어·사실 검사. 내용을 고치면 그 글의 `updated` 를 바꾼다 |
| 목장 소식 | `lib/news-server.ts`·`lib/news-feed.ts` → `/story/news/<id>`, `/rss.xml` | 관리자(/admin/news)에서 게시하면 1시간 안에 글 주소·RSS·사이트맵·llms 에 반영 |

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

## 4. 결정 사항과 처리 결과 (2026-11-12 회장님 승인: 권고안대로)

| # | 항목 | 처리 |
|---|---|---|
| 1 | 판매 대상 — "회원에게만" ↔ 비회원 단품 | `/guide`·고객 도우미를 실제 운영(정기구독=회원, 단품=비회원 가능)으로 정정. **이용약관 제2조·제4조 개정**은 제3조에 따라 2026-11-12 공지 → **2026-11-19 자동 시행**(`lib/terms-revision.ts`, /terms 1시간 ISR). 개인정보처리방침에 비회원 주문 정보 항목을 명시(이미 수집 중인 항목 — 즉시 반영). |
| 2 | 해지 조건 — "최소 4회" ↔ 약관 "언제든" | 코드에 '최소 4회' 제한이 없음을 확인. `/guide`·고객 도우미를 약관 제7조(언제든 해지·미배송분 환불)로 통일. |
| 3 | '하루 500리터' | 근거 자료 미확보 → 홈 문구는 사장님이 테스트로 지켜 둔 결정이라 유지, **llms.txt·검색 문구에는 넣지 않음**(현행). 근거가 확인되면 상수로 올린다. |
| 4 | '국내 유일 A2 저지 목장' | 상세 페이지의 범위 밝힌 문구 유지(2026-11-11 결정). 검색 설명·llms.txt 에는 넣지 않음. **실증 자료(기관 확인서·통계)를 보관**해 두면 다시 넣을 수 있다. |
| 5 | FAQ '일반 우유'·"속이 불편할까요?" | 문항 교체: "A2 우유는 무엇이 다른가요?"(효능 미표시 명시), "저지 우유는 어떤 우유인가요?"(비교·베타카로틴 삭제). 테스트로 재발 방지. |
| 6 | 신선도 표현 | 사장님 FAQ 기준(아침 착유 → 그날 가공 → 다음 날 발송)으로 홈·/story·구독 소개 문구 통일. |
| 7 | 영문 표준명 | **Song Young Shin Farm** 확정(푸터·구조화데이터 맨 앞). 예전 표기는 별칭으로 남김. |
| 8 | 브랜드 홈(Wix) 정보 불일치 | Wix 관리자 권한이 필요해 남은 일 — 아래 문구로 맞춘다. |
| 9 | 고객 도우미 지식 | '건초만'·'자연 방목'·다른 우유 비교·외부 연구 배수·'EU 기준 그대로'·'최소 4회' 정정, 테스트로 고정. |
| 10 | 우편번호 | 확인되면 `lib/site.ts` `ADDRESS_PARTS` 에 더한다. |

**Wix 브랜드 홈(www.a2jerseymilk.com) 정렬 문구** — 사이트 설정 → SEO 기본 → 홈페이지 설명:
> 송영신목장은 경기도 안성의 A2 저지 목장입니다. A2/A2 저지를 사일리지 없는 유럽 전통 헤이밀크 방식으로 기르고, 동물복지축산농장·저탄소 축산물 농장 인증을 받았습니다. 공식 온라인몰 shop.a2jerseymilk.com

함께 고칠 것: 푸터 영문명 'Song Young Shin Dairy Farm' → 'Song Young Shin Farm', 주소·전화·사업자번호를 쇼핑몰(`lib/site.ts` BUSINESS)과 같은 값으로(목장 주소와 법인 주소가 다르면 둘 다 밝힌다), '대한민국 0.1%'·'최상급' 문구 삭제.

## 5. 2단계(콘텐츠) — 2026-11-12 완료분과 남은 일

| 항목 | 상태 |
|---|---|
| 목장 소식 개별 주소 `/story/news/<id>` + BlogPosting 구조화데이터 + 서버 렌더 | 완료 |
| `/rss.xml`(본문 전체, 사이트 도메인 링크만) + 홈·/story·소식 글의 RSS 알림 링크 | 완료 — **운영 DB 에 게시된 소식이 0건**이라 네이버 RSS 제출은 첫 소식 게시 후(네이버는 글 1개 이상인 피드만 받는다) |
| 해설 페이지 `/learn` + A2 우유·저지(1885)·헤이밀크·인증 목장 4편(출처 명시, Article 구조화데이터) | 완료 |
| 사이트맵·llms.txt 에 해설·소식 연결, 푸터·/faq 내부 링크 | 완료 |
| 소식 글 문구 검사 | 남은 일 — DB 에서 오는 글은 금지어 검사를 거치지 않는다. 관리자 편집기에 금지어 경고(건초만·방목·소화·면역·일반 우유·최초/최고/유일·'동물복지 우유')를 넣는 것을 권한다 |
| 소식 게시일 | 남은 일 — 지금은 작성 시각(created_at)을 게시일로 쓴다. 초안을 오래 두었다 게시하면 날짜가 앞당겨진다 → `published_at` 컬럼 추가 권장(운영 DB 확인 후) |
| /order-once 서버 렌더 소개 | 남은 일(첫 HTML 이 '불러오는 중…') |
| 네이버 블로그(78redmoon) 연계·월간 AI 인용 측정 | 사람이 할 일 — 보고서의 측정표 사용 |
