# AI·검색 발견성(GEO/AEO) + 카톡 추천 버튼 설계

> 작성일 2026-06-02 · 상태: 설계(승인 완료, 스펙 확정)

## 1. 배경 / 문제

송영신목장은 **하루 500리터 한정 · 선착순 500인 회원제**라는 희소성 브랜드다. 목표는 **2개월 내 정기구독 회원 500명** 확보. 이를 위해 사이트가 두 가지로 부족하다.

1. **발견성** — 검색엔진·AI 비서(ChatGPT·Claude·Perplexity·Google AI)가 사이트를 읽고 인용할 "기계용 재료"가 거의 없다. 현재 `app/layout.tsx`에 기본 메타데이터와 `app/manifest.ts`(PWA)만 있고, **JSON-LD 구조화 데이터·robots·sitemap·llms.txt·OG 이미지가 전무**하다.
2. **공유(입소문)** — 회원이 지인에게 사이트를 추천할 수단이 없다. 한국 시장 특성상 카카오톡 공유가 핵심 유입 채널이다.

두 작업은 **하나의 메타데이터/OG 기반을 공유**한다. 카톡으로 링크를 보낼 때 뜨는 카드는 GEO를 위해 만드는 OG 이미지·메타데이터를 그대로 사용한다. 한 번의 기반 작업이 발견성과 공유 양쪽에서 일한다.

### 명시적 비목표 (YAGNI)

- **추천 추적/리워드/리더보드 없음** — 단순 공유 버튼만. "누가 데려왔는지" 추적 안 함.
- **카카오 SDK(리치 피드 카드) 사용 안 함** — 외부 앱 등록·JS키가 필요하므로 채택하지 않는다. 표준 Web Share + OG 카드로 충분.
- **구독기간(4/8/12주) 선택 기능은 이 스펙 범위 밖** — DB·가격·결제·기존 회원제 모델을 바꾸는 별도 설계 사이클로 분리한다.
- **동적 OG 생성(next/og) 없음** — 정적 OG 이미지 1장.
- **다국어·별도 철학 페이지 없음** — 철학은 외부 브랜드 홈(`BRAND_HOME`) 링크 유지.
- **SSG 전환 변경 없음** — 홈은 SSG 유지. ShareButton만 클라이언트 섬.

## 2. 목표

방문/검색/AI 질의 시 사이트가 **읽히고 인용되며**, 회원이 **한 번의 탭으로 지인에게 사이트를 공유**할 수 있게 한다. **사업자·주소·연락처**는 기존 단일 진실 공급원(`lib/site.ts`의 `BUSINESS`)에서, **제품 정보**는 `lib/products.ts`에서 파생해 푸터·구조화 데이터·공유 카드가 **서로 어긋나지 않도록** 한다. 단, 영업시간·`priceRange`처럼 `lib/site.ts`에 없는 표시용 값은 빌더 내 **명시 상수**로 둔다(SSOT가 아닌 표현 리터럴임을 코드 주석으로 명시).

## 3. 아키텍처 — 공유 기반 1 + 소비자 2

```
lib/site.ts (SSOT: BUSINESS·BRAND_HOME·DEPOSIT)
        │
        ├─ lib/seo/schema.ts (순수 빌더) ──→ <JsonLd> ──→ 검색·AI (GEO)
        │                                  │
        └─ OG 이미지·메타데이터 (layout) ──┴──→ ShareButton (카톡 공유 카드)
```

세 레이어 모두 데이터를 `lib/site.ts`(및 제품 데이터)에서 읽는다. 표현(컴포넌트)만 분리하고 데이터·순수 로직은 공유한다.

## 4. 범위 (영향 파일)

### 신규

| 파일 | 책임 |
|---|---|
| `lib/seo/schema.ts` | **순수 빌더**: `buildOrganization()`·`buildWebSite()`·`buildLocalBusiness()`·`buildProduct(p)`·`buildFAQPage(items)`. 입력=`lib/site.ts`·제품데이터, 출력=JSON-LD 평문 객체(불변) |
| `lib/seo/schema.test.ts` | 빌더 vitest — `@type`·필수 필드·가격·주소·FAQ 구조 검증 |
| `lib/seo/faq.ts` | 가이드(`app/guide`) 기반 Q&A 데이터(배송·교환/환불·회원제) — `buildFAQPage` 입력 |
| `components/JsonLd.tsx` | `<script type="application/ld+json">` 렌더 서버 컴포넌트(`JSON.stringify` 단일 책임) |
| `components/ShareButton.tsx` | `"use client"` — Web Share + 클립보드 폴백 |
| `app/robots.ts` | `MetadataRoute.Robots` — 전체 허용(AI 크롤러 포함)·비공개 경로 차단·sitemap 지정 |
| `app/sitemap.ts` | `MetadataRoute.Sitemap` — 공개 경로 목록 |
| `public/llms.txt` | LLM용 사이트 요약(llms.txt 표준 마크다운) |
| `public/brand/og-default.jpg` | 1200×630 OG 카드 (기존 hero 사진 `sips` 가공) |

### 수정

| 파일 | 변경 |
|---|---|
| `app/layout.tsx` | `openGraph.images`(og-default)+`twitter` 카드 추가, 전역 `<JsonLd>`(Organization+WebSite) |
| `app/page.tsx` | 홈에 `<JsonLd>`(LocalBusiness+FAQPage) |
| `app/products/[id]/page.tsx` | 제품별 `<JsonLd>`(Product+Offer). **라우트 파라미터는 `id`**(`[slug]` 아님). `getProduct(id)`로 제품 조회 |
| `app/guide`·`app/terms`·`app/privacy` (서버 컴포넌트, 이미 `metadata` 있음) | `alternates.canonical`만 보강 |
| **신규** `app/signup/layout.tsx`·`app/order-once/layout.tsx` | `signup`·`order-once` page는 `"use client"`라 `metadata` 직접 export 불가 → **서버 `layout.tsx`를 신규 추가해 거기서 `metadata`(title/description/canonical) export** |
| `app/account/page.tsx` (`"use client"`) | `<ShareButton>` 배치(회원 영역). 클라이언트 컴포넌트이므로 metadata 추가 대상 아님 |

## 5. GEO/AEO 레이어 상세

### 5.1 순수 빌더 (`lib/seo/schema.ts`, TDD)

각 함수는 부수효과 없이 JSON-LD 객체를 반환한다. 데이터는 `BUSINESS`/`BRAND_HOME`(`lib/site.ts`)과 제품 데이터에서만 읽는다.

- `buildOrganization()` — `@type: "Organization"`, name=`BUSINESS.company`, url=`metadataBase`, logo, sameAs=[`BRAND_HOME`]
- `buildWebSite()` — `@type: "WebSite"`, name·url·inLanguage `ko-KR`
- `buildLocalBusiness()` — `@type: ["LocalBusiness","Farm"]`, name=한글 상호, address=`PostalAddress`(`BUSINESS.address`), telephone=`BUSINESS.tel`. `openingHours`(월–금 09:00–18:00)·`priceRange`는 **`lib/site.ts`에 없는 표시용 리터럴** → 빌더 내 명시 상수로 선언하고 "SSOT 아님" 주석 표기
- `buildProduct(p)` — `@type: "Product"`, `name`=`p.name`, `image`=`p.image`, `description`=**`p.shortDesc`**(`Product`에는 `description` 필드가 없음; `shortDesc`/`story`/`tagline` 중 `shortDesc` 사용) + `offers: Offer`(`price`=`p.price`·`priceCurrency: "KRW"`·`availability`)
- `buildFAQPage(items)` — `@type: "FAQPage"`, mainEntity=Question/Answer 배열

**단위 테스트**: 각 빌더가 올바른 `@type`·필수 필드를 갖는가; Product offer 가격/통화; LocalBusiness 주소가 `BUSINESS.address`와 일치; FAQPage가 입력 items 수만큼 Question을 갖는가.

### 5.2 `components/JsonLd.tsx`

```tsx
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

- 단일 책임: 직렬화+렌더. XSS 안전(데이터는 내부 SSOT 파생, 사용자 입력 아님). 서버 컴포넌트(SSG 유지).

### 5.3 robots / sitemap

- `app/robots.ts`: `rules`에 모든 봇 `allow: "/"`, `disallow: ["/admin","/account","/checkout","/api","/login","/forgot-password","/reset-password"]`. AI 크롤러(`GPTBot`·`ClaudeBot`·`PerplexityBot`·`Google-Extended`) 명시 환영. `sitemap` 필드 지정.
- `app/sitemap.ts`: 공개 경로(`/`·제품 4종·`/order-once`·`/signup`·`/guide`·`/terms`·`/privacy`), 각 `lastModified`. **제품 URL은 `lib/products.ts`의 `id`로 생성**(`/products/${id}`; 예 `milk-180`). 푸터가 쓰는 `/products/milk-180` 류 URL은 슬러그처럼 보이지만 실제로는 `[id]` 라우트에 `id` 값이 들어가는 것 — 동일 경로다.

### 5.4 llms.txt

`public/llms.txt`, llms.txt 표준 마크다운:
- H1 사이트명 + blockquote 한 줄 요약("경기도 안성, 하루 500리터 한정 A2 저지 헤이밀크 회원제 정기구독")
- 섹션별 핵심 링크(회원제 정기구독, 제품, 배송/교환·환불 가이드, 목장 철학=외부)
- AI가 "무엇을 파는 누구인지" 한 번에 파악할 브랜드 서사 3–4줄

### 5.5 OG / 메타데이터

- `public/brand/og-default.jpg`(1200×630) — 기존 `public/brand/hero-row-white.jpg`를 `sips`로 크롭/리사이즈(원본 보존, 사본 생성).
- `app/layout.tsx`의 `metadata.openGraph.images`에 og-default + `metadata.twitter`(`card: "summary_large_image"`).
- 공개 페이지별 `alternates.canonical`·title·description 보강. **서버 페이지(`guide`·`terms`·`privacy`)는 기존 `metadata`에 canonical 추가**; **클라이언트 페이지(`signup`·`order-once`)는 신규 `layout.tsx`(서버)에서 `metadata` export**(§4). `account`는 회원 전용·noindex 대상이라 메타 보강 제외.

## 6. 카톡 추천 버튼 상세 (`components/ShareButton.tsx`, `"use client"`)

- 클릭 → `navigator.share({ title, text, url })`. 모바일에서 OS 공유 시트→카톡 선택 시 **우리 OG 카드 그대로 전송**.
- 폴백: `navigator.share` 미지원(주로 데스크톱) → `navigator.clipboard.writeText(url)` + "링크가 복사됐어요" 토스트(`role="status"`).
- **추적 없음**. 공유 URL은 우리 사이트(`metadataBase` 기반 절대 URL), 외부 `BRAND_HOME` 아님.
- 에러 처리: `share()`의 `AbortError`(사용자 취소)는 무시, 그 외 실패는 클립보드 폴백으로 흡수.
- 배치: **`app/account/page.tsx`(회원 영역)** — "친구에게 송영신목장 알리기". "회원가입한 사람이" 요건 충족.
- a11y: 버튼 `aria-label`, 토스트 `role="status"`.
- 불변성: 상태는 토스트 표시 여부만(`useState`), 기존 객체 변형 없음.

## 7. 데이터 흐름

1. 빌드 시 `schema.ts` 빌더가 `lib/site.ts`(사업자)·`lib/products.ts`(제품) 데이터로 JSON-LD를 만들고 `<JsonLd>`가 각 페이지(SSG)에 인라인. 영업시간·`priceRange`는 빌더 내 표시 상수.
2. 크롤러/AI가 robots→sitemap→각 페이지의 JSON-LD·llms.txt를 읽음.
3. 사용자가 링크 공유 → 카톡/SNS가 OG 메타·이미지로 카드 렌더.
4. ShareButton은 런타임에 `navigator.share`/clipboard만 호출(서버 의존 없음).

## 8. 에러 / 엣지

- `navigator.share` 미지원·`AbortError`: §6 폴백/무시.
- OG 이미지 누락 시: 빌드가 깨지지 않도록 경로 존재를 자산 태스크에서 보장(없으면 카드 이미지만 빠지고 텍스트는 정상).
- 제품 데이터 비어 있음: `buildProduct`는 입력 검증 후 안전한 기본값/스킵(빈 배열이면 Product JSON-LD 생략).
- JSON-LD는 사용자 입력을 포함하지 않으므로 XSS 위험 없음(내부 SSOT만).

## 9. 테스트 / 검증

- **단위(TDD)**: `schema.ts` 빌더(@type·가격·주소·FAQ 구조)·`faq.ts` 무결성.
- **ShareButton**: jsdom에서 `navigator.share` 모킹 → (a) 지원 시 호출, (b) 미지원 시 clipboard 폴백, (c) `AbortError` 무시 분기.
- **빌드 게이트**: `rm -rf .next && npx vitest run && npx tsc --noEmit && npx next build` — 홈 SSG 유지, `app/robots.ts`·`app/sitemap.ts` 라우트 생성 확인, 변경 파일 eslint 0(신규 위반 없음).
- **배포 후 수동**: 구글 리치 결과 테스트로 JSON-LD 검증; 실제 카톡으로 링크 전송해 OG 카드(이미지·제목·설명) 확인; `/{robots.txt,sitemap.xml,llms.txt}` 200 확인.
- 구현 전 `node_modules/next/dist/docs/`에서 `robots`/`sitemap`/metadata·route 규약 확인(AGENTS.md).

## 10. 리스크

- **봇 접근성**: 사이트는 `shop.a2jerseymilk.com`으로 라이브 확인됨 — GEO가 즉시 효과. 비공개 경로는 robots로 차단.
- **정보 불일치**: 모든 사업자/주소/연락처를 `lib/site.ts`에서 파생해 푸터와 어긋나지 않게.
- **OG 캐시**: 카톡/SNS는 OG를 캐시함 — 배포 후 카카오/페이스북 디버거로 캐시 갱신 필요(수동 검증 단계 포함).
- **개인정보**: 정확한 목장 주소 공개는 사용자 승인 결정사항(이미 푸터에 게재된 공개 정보).

## 11. 후속 (이 스펙 밖, 별도 사이클)

- **구독기간 4/8/12주 선택** — DB(term)·가격(배수/할인)·`/signup`·`/checkout`·기존 500석/요일 모델과의 상호작용(만료·갱신·카운터)을 별도 brainstorming→스펙→플랜→구현으로 다룬다.
