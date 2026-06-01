# GEO/AEO 발견성 + 카톡 공유 버튼 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색·AI 비서가 사이트를 읽고 인용할 구조화 데이터/크롤 자산(JSON-LD·robots·sitemap·llms.txt·OG)을 깔고, 회원이 한 번의 탭으로 카톡 등으로 사이트를 공유하는 버튼을 추가한다.

**Architecture:** 사업자 정보는 `lib/site.ts`(`BUSINESS`), 제품 정보는 `lib/products.ts`(`PRODUCTS`)를 단일 진실 공급원으로 삼아 `lib/seo/schema.ts`의 **순수 빌더**가 JSON-LD를 만들고, 얇은 `<JsonLd>` 서버 컴포넌트가 각 SSG 페이지에 인라인한다. 공유는 `lib/share.ts`의 **순수 함수** `shareOrCopy()`(주입형 navigator)로 로직을 분리하고 `ShareButton` 클라이언트 컴포넌트는 얇게 유지한다.

**Tech Stack:** 수정된 Next.js 16(`next build --webpack`), React 19, TypeScript 5, Tailwind 4, vitest 4(`node` 환경, `lib/**/*.test.ts`만 포함).

**Spec:** `docs/superpowers/specs/2026-06-02-geo-discoverability-kakao-share-design.md`

## 사전 필독 (구현 시작 전)

- `AGENTS.md` 지시대로, robots/sitemap/metadata/route 규약은 **`node_modules/next/dist/docs/`** 에서 먼저 확인한다(훈련 데이터의 Next와 다를 수 있음).
- 테스트는 **반드시 `lib/` 아래에 colocate**(`vitest.config.ts`의 `include: ["lib/**/*.test.ts"]`). 컴포넌트 단위 테스트용 jsdom/RTL은 도입하지 않는다(YAGNI).
- 모든 데이터는 SSOT에서 파생: 사업자=`lib/site.ts`, 제품=`lib/products.ts`. 영업시간·`priceRange`처럼 SSOT에 없는 값만 빌더 내 표시 상수로 두고 "SSOT 아님" 주석을 단다.
- 불변성 유지(스프레드, 변형 금지). `console.log` 금지. 커밋은 작업 단위로 자주.
- **스펙과의 의도적 차이**: 스펙 §9는 ShareButton을 "jsdom mock"으로 테스트한다고 했으나, 이 저장소 vitest는 `node` 환경이라 jsdom/RTL이 없다. 새 테스트 인프라 도입 대신 공유 **로직을 `lib/share.ts` 순수 함수로 추출**해 node에서 테스트한다(같은 3분기를 검증, 의존성 0). 컴포넌트는 얇게 유지(다른 컴포넌트와 동일하게 미테스트).

---

## Chunk 1: SEO 데이터 · 순수 빌더 · JsonLd 주입

### Task 1: `SITE_URL` 상수 (SSOT) + layout metadataBase 연결

스키마 빌더가 절대 URL을 만들려면 사이트 기준 URL이 필요하다. 현재 `app/layout.tsx:33`에 `"https://shop.a2jerseymilk.com"`이 하드코딩돼 있다. `lib/site.ts`로 끌어올려 단일 출처로 만든다.

**Files:**
- Modify: `lib/site.ts` (상단에 상수 추가)
- Modify: `app/layout.tsx:33`

- [ ] **Step 1: `lib/site.ts`에 `SITE_URL` 추가**

`BRAND_HOME` 선언 위에 추가:

```ts
// 이 스토어프론트의 공개 기준 URL(메타데이터·구조화 데이터·공유 링크의 절대 URL 기준).
export const SITE_URL = "https://shop.a2jerseymilk.com";
```

- [ ] **Step 2: `app/layout.tsx`에서 참조**

import에 `SITE_URL` 추가하고(기존 `@/lib/...` import 옆), `metadataBase`를 교체:

```ts
import { SITE_URL } from "@/lib/site";
// ...
  metadataBase: new URL(SITE_URL),
```

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: exit 0 (에러 없음)

- [ ] **Step 4: Commit**

```bash
git add lib/site.ts app/layout.tsx
git commit -m "refactor: lift SITE_URL to lib/site.ts as single source"
```

---

### Task 2: FAQ 데이터 (`lib/seo/faq.ts`)

FAQPage JSON-LD의 입력이 될 Q&A 데이터. 배송·교환/환불은 `app/guide/page.tsx`, 회원제는 스펙/제품 정책과 일치시킨다. **구현자는 `app/guide/page.tsx`를 열어 문구를 실제 안내와 어긋나지 않게 맞춘다.**

**Files:**
- Create: `lib/seo/faq.ts`

- [ ] **Step 1: FAQ 데이터 작성**

```ts
// 검색·AI가 인용할 FAQ 데이터. buildFAQPage(FAQ_ITEMS)의 입력.
// 배송·교환/환불 문구는 app/guide/page.tsx와 일치시킨다(불일치 시 가이드를 진실로 본다).
export type FaqItem = { question: string; answer: string };

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "정기구독은 어떻게 신청하나요?",
    answer:
      "선착순 500인 한정 회원제입니다. 월–금 중 배송 요일 하나를 골라 매주 1회 받으시며, 1개월(4회분)을 무통장입금으로 선납합니다. 회원 할인 10%가 적용됩니다.",
  },
  {
    question: "배송은 언제 시작되나요?",
    answer:
      "무통장입금이 확인된 다음 날(월–금)부터 신선한 상태로 발송합니다. 매주 같은 요일에 배송됩니다.",
  },
  {
    question: "교환이나 환불이 되나요?",
    answer:
      "신선식품 특성상 단순 변심 교환·환불은 어렵습니다. 다만 상품에 하자가 있거나 오배송된 경우 수령 후 빠르게 연락 주시면 교환 또는 환불해 드립니다. 정기구독 해지 시 남은 회차분은 환불됩니다.",
  },
  {
    question: "A2 저지 헤이밀크가 무엇인가요?",
    answer:
      "A2 단백질만 내는 저지 품종 젖소에서 짠 우유로, 사일리지 없이 건초만 먹여 기릅니다. 경기도 안성 송영신목장이 직접 짓고 발효해 보냅니다.",
  },
  {
    question: "회원이 아니어도 살 수 있나요?",
    answer:
      "네. 정기구독과 별개로 단품(1회) 구매가 가능합니다. 상품 합계 25,000원 이상부터 주문하실 수 있습니다.",
  },
] as const;
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add lib/seo/faq.ts
git commit -m "feat: add FAQ data for FAQPage structured data"
```

---

### Task 3: 순수 스키마 빌더 (`lib/seo/schema.ts`, TDD)

JSON-LD 객체를 반환하는 순수 함수들. 부수효과 없음. 데이터는 `lib/site.ts`·`lib/products.ts`·`FAQ_ITEMS`에서만 읽는다.

**Files:**
- Create: `lib/seo/schema.ts`
- Test: `lib/seo/schema.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/seo/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildOrganization,
  buildWebSite,
  buildLocalBusiness,
  buildProduct,
  buildFAQPage,
} from "./schema";
import { BUSINESS, SITE_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/products";
import { FAQ_ITEMS } from "./faq";

describe("buildOrganization", () => {
  it("Organization 타입과 SSOT 기반 필드를 갖는다", () => {
    const org = buildOrganization();
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe(BUSINESS.company);
    expect(org.url).toBe(SITE_URL);
    expect(org.sameAs).toContain("https://www.a2jerseymilk.com");
  });
});

describe("buildWebSite", () => {
  it("WebSite 타입과 한국어 로케일을 갖는다", () => {
    const site = buildWebSite();
    expect(site["@type"]).toBe("WebSite");
    expect(site.url).toBe(SITE_URL);
    expect(site.inLanguage).toBe("ko-KR");
  });
});

describe("buildLocalBusiness", () => {
  it("LocalBusiness/Farm 타입과 SSOT 주소·전화를 갖는다", () => {
    const lb = buildLocalBusiness();
    expect(lb["@type"]).toEqual(["LocalBusiness", "Farm"]);
    expect(lb.telephone).toBe(BUSINESS.tel);
    expect(lb.address["@type"]).toBe("PostalAddress");
    expect(lb.address.streetAddress).toBe(BUSINESS.address);
    expect(lb.address.addressCountry).toBe("KR");
    // 영업시간은 SSOT가 아닌 표시 리터럴
    expect(lb.openingHours).toBeTruthy();
  });
});

describe("buildProduct", () => {
  it("Product 타입 + KRW Offer + shortDesc 설명 + 절대 이미지 URL", () => {
    const p = PRODUCTS[0];
    const node = buildProduct(p);
    expect(node["@type"]).toBe("Product");
    expect(node.name).toBe(p.name);
    expect(node.description).toBe(p.shortDesc);
    expect(node.image).toBe(`${SITE_URL}${p.image}`);
    expect(node.offers["@type"]).toBe("Offer");
    expect(node.offers.price).toBe(p.price);
    expect(node.offers.priceCurrency).toBe("KRW");
  });
});

describe("buildFAQPage", () => {
  it("입력 items 수만큼 Question을 만든다", () => {
    const faq = buildFAQPage(FAQ_ITEMS);
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(FAQ_ITEMS.length);
    expect(faq.mainEntity[0]["@type"]).toBe("Question");
    expect(faq.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
    expect(faq.mainEntity[0].name).toBe(FAQ_ITEMS[0].question);
  });

  it("빈 입력이면 mainEntity가 빈 배열", () => {
    expect(buildFAQPage([]).mainEntity).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/seo/schema.test.ts`
Expected: FAIL ("Cannot find module './schema'" 또는 함수 미정의)

- [ ] **Step 3: 최소 구현 작성**

`lib/seo/schema.ts`:

```ts
import { BUSINESS, BRAND_HOME, SITE_URL } from "@/lib/site";
import type { Product } from "@/lib/products";
import type { FaqItem } from "./faq";

// 모든 빌더는 부수효과 없는 순수 함수. JSON-LD 평문 객체를 반환한다.
// 사업자/주소/연락처는 lib/site.ts, 제품은 인자로 받은 Product에서만 읽는다.

export function buildOrganization() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BUSINESS.company,
    url: SITE_URL,
    logo: `${SITE_URL}/brand/heymilk-logo.png`,
    sameAs: [BRAND_HOME],
  } as const;
}

export function buildWebSite() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "송영신목장 · A2 Jersey Hay Milk",
    url: SITE_URL,
    inLanguage: "ko-KR",
  } as const;
}

export function buildLocalBusiness() {
  // openingHours·priceRange는 lib/site.ts에 없는 표시용 리터럴(SSOT 아님).
  return {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "Farm"],
    name: "송영신목장",
    url: SITE_URL,
    telephone: BUSINESS.tel,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address,
      addressCountry: "KR",
    },
    openingHours: "Mo-Fr 09:00-18:00", // 표시 리터럴(SSOT 아님)
    priceRange: "₩₩", // 표시 리터럴(SSOT 아님)
  } as const;
}

export function buildProduct(p: Product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: `${SITE_URL}${p.image}`,
    description: p.shortDesc, // Product에는 description 필드가 없어 shortDesc를 사용
    brand: { "@type": "Brand", name: "송영신목장" },
    offers: {
      "@type": "Offer",
      price: p.price,
      priceCurrency: "KRW",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/products/${p.id}`,
    },
  } as const;
}

export function buildFAQPage(items: readonly FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  } as const;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/seo/schema.test.ts`
Expected: PASS (전부 통과)

- [ ] **Step 5: Commit**

```bash
git add lib/seo/schema.ts lib/seo/schema.test.ts
git commit -m "feat: add pure JSON-LD schema builders (TDD)"
```

---

### Task 4: `<JsonLd>` 컴포넌트 + 페이지 주입

JSON-LD를 `<script>`로 렌더하는 얇은 서버 컴포넌트. 데이터는 내부 SSOT 파생(사용자 입력 아님)이라 XSS 안전.

**Files:**
- Create: `components/JsonLd.tsx`
- Modify: `app/layout.tsx` (전역 Organization+WebSite)
- Modify: `app/page.tsx` (홈: LocalBusiness+FAQPage)
- Modify: `app/products/[id]/page.tsx` (제품: Product+Offer)

- [ ] **Step 1: `components/JsonLd.tsx` 작성**

```tsx
// JSON-LD 한 덩어리를 <script type="application/ld+json">로 렌더한다.
// data는 내부 SSOT에서 파생되는 객체이며 사용자 입력을 포함하지 않는다.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
```

- [ ] **Step 2: layout에 Organization+WebSite 주입**

`app/layout.tsx`의 `<body>` 최상단(`<AuthProvider>` 바로 안)에 추가. import 추가:

```tsx
import { JsonLd } from "@/components/JsonLd";
import { buildOrganization, buildWebSite } from "@/lib/seo/schema";
```

`<body ...>` 직후:

```tsx
        <JsonLd data={buildOrganization()} />
        <JsonLd data={buildWebSite()} />
```

- [ ] **Step 3: 홈에 LocalBusiness+FAQPage 주입**

`app/page.tsx`:

```tsx
import { JsonLd } from "@/components/JsonLd";
import { buildLocalBusiness, buildFAQPage } from "@/lib/seo/schema";
import { FAQ_ITEMS } from "@/lib/seo/faq";
```

`<>` 바로 안, `<Hero />` 위:

```tsx
      <JsonLd data={buildLocalBusiness()} />
      <JsonLd data={buildFAQPage(FAQ_ITEMS)} />
```

- [ ] **Step 4: 제품 페이지에 Product+Offer 주입**

`app/products/[id]/page.tsx`에 import:

```tsx
import { JsonLd } from "@/components/JsonLd";
import { buildProduct } from "@/lib/seo/schema";
```

`return (` 직후 `<SwipeNav ...>` 바로 안(또는 최상단 자식)으로:

```tsx
      <JsonLd data={buildProduct(product)} />
```

- [ ] **Step 5: 빌드/타입 확인**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: exit 0. 홈(`/`)·제품(`/products/[id]`)이 여전히 정적(`○`/`●`)으로 prerender. JSON-LD가 빌드 HTML에 포함.

- [ ] **Step 6: Commit**

```bash
git add components/JsonLd.tsx app/layout.tsx app/page.tsx "app/products/[id]/page.tsx"
git commit -m "feat: inject Organization/WebSite/LocalBusiness/FAQ/Product JSON-LD"
```

---

## Chunk 2: 크롤 지시 · OG · 페이지 메타

### Task 5: `app/robots.ts`

**먼저 `node_modules/next/dist/docs/`에서 robots 파일 규약(`MetadataRoute.Robots`)을 확인한다.**

**Files:**
- Create: `app/robots.ts`

- [ ] **Step 1: 작성**

```ts
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PRIVATE = [
  "/admin",
  "/account",
  "/checkout",
  "/api",
  "/login",
  "/forgot-password",
  "/reset-password",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // AI 크롤러 명시 환영(전체 허용과 동일하나 의도를 분명히).
      { userAgent: "GPTBot", allow: "/", disallow: PRIVATE },
      { userAgent: "ClaudeBot", allow: "/", disallow: PRIVATE },
      { userAgent: "PerplexityBot", allow: "/", disallow: PRIVATE },
      { userAgent: "Google-Extended", allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
```

- [ ] **Step 2: 빌드 후 라우트 확인**

Run: `npx next build --webpack`
Expected: exit 0. 빌드 라우트 목록에 `/robots.txt` 표시.

- [ ] **Step 3: Commit**

```bash
git add app/robots.ts
git commit -m "feat: add robots.ts allowing AI crawlers, blocking private routes"
```

---

### Task 6: `app/sitemap.ts`

**먼저 `node_modules/next/dist/docs/`에서 sitemap 규약(`MetadataRoute.Sitemap`)을 확인한다.** 제품 URL은 `PRODUCTS`의 `id`로 생성(`/products/${id}`).

**Files:**
- Create: `app/sitemap.ts`

- [ ] **Step 1: 작성**

```ts
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/products";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = ["", "/order-once", "/signup", "/guide", "/terms", "/privacy"];
  const productPaths = PRODUCTS.map((p) => `/products/${p.id}`);
  return [...staticPaths, ...productPaths].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
  }));
}
```

- [ ] **Step 2: 빌드 후 라우트 확인**

Run: `npx next build --webpack`
Expected: exit 0. 라우트 목록에 `/sitemap.xml` 표시.

- [ ] **Step 3: Commit**

```bash
git add app/sitemap.ts
git commit -m "feat: add sitemap.ts for public + product routes"
```

---

### Task 7: `public/llms.txt`

llms.txt 표준 마크다운. AI가 "무엇을 파는 누구인지" 한 번에 파악하게.

**Files:**
- Create: `public/llms.txt`

- [ ] **Step 1: 작성**

```markdown
# 송영신목장 · A2 Jersey Hay Milk

> 경기도 안성, 하루 500리터만 생산하는 A2 저지 헤이밀크 회원제 정기구독. 선착순 500인 한정. 사일리지 없이 건초만 먹인 저지소의 우유를 목장이 직접 짓고 발효해 보냅니다.

송영신목장(농업회사법인 디투오)은 대한민국 0.01%의 희소한 A2/A2 저지소에서 짠 우유로 헤이밀크와 플레인 요거트를 만듭니다. 양보다 가치를 택해 하루 생산량을 500리터로 한정하고, 정기구독은 선착순 500인 회원제로만 운영합니다. 매주 1회(월–금 중 택1) 배송하며 무통장입금으로 선납합니다.

## 핵심 링크

- [정기구독 신청](https://shop.a2jerseymilk.com/signup): 선착순 500인 한정 회원제 정기구독
- [제품 — 헤이밀크 180mL](https://shop.a2jerseymilk.com/products/milk-180)
- [제품 — 헤이밀크 750mL](https://shop.a2jerseymilk.com/products/milk-750)
- [제품 — 플레인 요거트 180mL](https://shop.a2jerseymilk.com/products/yogurt-180)
- [제품 — 플레인 요거트 500mL](https://shop.a2jerseymilk.com/products/yogurt-500)
- [단품(1회) 구매](https://shop.a2jerseymilk.com/order-once): 회원이 아니어도 구매 가능
- [배송 · 교환/환불 안내](https://shop.a2jerseymilk.com/guide)

## 목장 철학

- [브랜드 홈 — 목장 이야기](https://www.a2jerseymilk.com): 지속가능한 토양과 소, 한정 생산 철학
```

- [ ] **Step 2: 배포 후 접근 확인(빌드만 우선)**

Run: `npx next build --webpack`
Expected: exit 0. (정적 파일이라 빌드 영향 없음. 배포 후 `/{llms.txt}` 200은 §Task 11 수동 검증.)

- [ ] **Step 3: Commit**

```bash
git add public/llms.txt
git commit -m "feat: add llms.txt for AI grounding"
```

---

### Task 8: OG 이미지 자산 + layout OG/twitter

`public/brand/hero-row-white.jpg`(1448×1086)에서 1200×630 OG 카드를 만든다(원본 보존, 사본 생성). macOS `sips` 사용.

**Files:**
- Create: `public/brand/og-default.jpg`
- Modify: `app/layout.tsx` (openGraph.images + twitter)

- [ ] **Step 1: OG 이미지 생성**

```bash
sips --resampleWidth 1200 public/brand/hero-row-white.jpg --out /tmp/og-wide.jpg
sips -c 630 1200 /tmp/og-wide.jpg --out public/brand/og-default.jpg
sips -g pixelWidth -g pixelHeight public/brand/og-default.jpg
```
Expected: 마지막 명령이 `pixelWidth: 1200`, `pixelHeight: 630` 출력.

- [ ] **Step 2: layout 메타에 OG 이미지·트위터 카드 추가**

`app/layout.tsx`의 `metadata.openGraph`에 `images` 추가, 최상위에 `twitter` 추가:

```ts
  openGraph: {
    title: "송영신목장 · A2 Jersey Hay Milk",
    description: "한 잔의 정직함. 경기도 안성, 송영신목장의 A2 저지 헤이밀크와 플레인 요거트.",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "송영신목장 · A2 Jersey Hay Milk",
    description: "한 잔의 정직함. 경기도 안성, 송영신목장의 A2 저지 헤이밀크와 플레인 요거트.",
    images: ["/brand/og-default.jpg"],
  },
```

- [ ] **Step 3: 빌드/타입 확인**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: exit 0. 빌드 HTML `<head>`에 `og:image`·`twitter:card` 포함.

- [ ] **Step 4: Commit**

```bash
git add public/brand/og-default.jpg app/layout.tsx
git commit -m "feat: add OG/twitter card image from brand photo"
```

---

### Task 9: 공개 페이지 canonical + 클라이언트 페이지 메타 layout

`guide`·`terms`·`privacy`는 서버 컴포넌트라 기존 `metadata`에 `alternates.canonical`만 추가. `signup`·`order-once`는 `"use client"`라 `metadata`를 직접 export할 수 없으므로 **서버 `layout.tsx`를 신규 추가**해 거기서 export. `account`는 회원 전용이라 제외(robots에서 이미 차단).

**Files:**
- Modify: `app/guide/page.tsx`, `app/terms/page.tsx`, `app/privacy/page.tsx` (canonical 추가)
- Create: `app/signup/layout.tsx`, `app/order-once/layout.tsx`

- [ ] **Step 1: 서버 페이지 canonical 추가**

세 파일 각각의 `export const metadata: Metadata = { ... }`에 `alternates`를 추가. 예(`app/guide/page.tsx`):

```ts
export const metadata: Metadata = {
  title: "배송 · 교환/환불 안내",
  alternates: { canonical: "/guide" },
};
```
`terms` → `canonical: "/terms"`, `privacy` → `canonical: "/privacy"` 동일 패턴.

- [ ] **Step 2: signup/order-once 서버 layout 생성**

`app/signup/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "정기구독 신청",
  description: "선착순 500인 한정 A2 저지 헤이밀크 회원제 정기구독을 신청하세요.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

`app/order-once/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "단품 구매",
  description: "회원이 아니어도 구매할 수 있는 A2 저지 헤이밀크·플레인 요거트 단품(1회) 주문.",
  alternates: { canonical: "/order-once" },
};

export default function OrderOnceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 3: 빌드/타입 확인**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: exit 0. `signup`·`order-once`가 여전히 정상 렌더(레이아웃은 children 패스스루).

- [ ] **Step 4: Commit**

```bash
git add app/guide/page.tsx app/terms/page.tsx app/privacy/page.tsx app/signup/layout.tsx app/order-once/layout.tsx
git commit -m "feat: add canonical metadata to public pages"
```

---

## Chunk 3: 카톡 공유 버튼

### Task 10: 순수 공유 로직 (`lib/share.ts`, TDD)

Web Share / 클립보드 폴백 로직을 주입형 순수 함수로 분리. node에서 mock navigator로 테스트.

**Files:**
- Create: `lib/share.ts`
- Test: `lib/share.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/share.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { shareOrCopy, type ShareDeps } from "./share";

const PAYLOAD = { title: "송영신목장", text: "A2 저지 헤이밀크", url: "https://shop.a2jerseymilk.com" };

describe("shareOrCopy", () => {
  it("navigator.share가 있으면 share를 호출하고 'shared' 반환", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const deps: ShareDeps = { share, writeText: vi.fn() };
    const res = await shareOrCopy(deps, PAYLOAD);
    expect(share).toHaveBeenCalledWith(PAYLOAD);
    expect(res).toBe("shared");
  });

  it("share가 없으면 클립보드에 url 복사하고 'copied' 반환", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const deps: ShareDeps = { share: undefined, writeText };
    const res = await shareOrCopy(deps, PAYLOAD);
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
    expect(res).toBe("copied");
  });

  it("사용자가 공유를 취소(AbortError)하면 'cancelled' 반환, 폴백 없음", async () => {
    const err = Object.assign(new Error("cancel"), { name: "AbortError" });
    const share = vi.fn().mockRejectedValue(err);
    const writeText = vi.fn();
    const res = await shareOrCopy({ share, writeText }, PAYLOAD);
    expect(res).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share가 AbortError 외 사유로 실패하면 클립보드로 폴백하고 'copied'", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const res = await shareOrCopy({ share, writeText }, PAYLOAD);
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
    expect(res).toBe("copied");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/share.test.ts`
Expected: FAIL ("Cannot find module './share'")

- [ ] **Step 3: 최소 구현 작성**

`lib/share.ts`:

```ts
// 공유 페이로드.
export type SharePayload = { title: string; text: string; url: string };

// 주입형 의존성: navigator.share / clipboard.writeText 를 분리해 순수 테스트 가능하게.
export type ShareDeps = {
  share?: (data: SharePayload) => Promise<void>;
  writeText: (text: string) => Promise<void>;
};

export type ShareResult = "shared" | "copied" | "cancelled";

// Web Share 우선, 미지원/실패 시 클립보드 복사 폴백. 사용자 취소(AbortError)는 조용히 무시.
export async function shareOrCopy(
  deps: ShareDeps,
  payload: SharePayload
): Promise<ShareResult> {
  if (deps.share) {
    try {
      await deps.share(payload);
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      // 그 외 실패는 폴백으로 진행
    }
  }
  await deps.writeText(payload.url);
  return "copied";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/share.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add lib/share.ts lib/share.test.ts
git commit -m "feat: add pure shareOrCopy logic (Web Share + clipboard fallback, TDD)"
```

---

### Task 11: `ShareButton` 컴포넌트 + 계정 페이지 배치

얇은 클라이언트 컴포넌트. `lib/share.ts`를 호출하고 결과에 따라 토스트(`role="status"`)를 표시.

**Files:**
- Create: `components/ShareButton.tsx`
- Modify: `app/account/page.tsx` (프로필 카드 아래 배치)

- [ ] **Step 1: `components/ShareButton.tsx` 작성**

```tsx
"use client";

import { useState } from "react";
import { shareOrCopy, type SharePayload } from "@/lib/share";
import { SITE_URL } from "@/lib/site";

const PAYLOAD: SharePayload = {
  title: "송영신목장 · A2 저지 헤이밀크",
  text: "하루 500리터 한정, 선착순 500인 회원제. 송영신목장의 A2 저지 헤이밀크를 함께 받아요.",
  url: SITE_URL,
};

export function ShareButton() {
  const [toast, setToast] = useState<string | null>(null);

  async function onShare() {
    const nav =
      typeof navigator !== "undefined"
        ? navigator
        : (undefined as unknown as Navigator);
    const res = await shareOrCopy(
      {
        share: nav?.share ? (data) => nav.share(data) : undefined,
        writeText: (t) => nav.clipboard.writeText(t),
      },
      PAYLOAD
    );
    if (res === "copied") {
      setToast("링크가 복사됐어요. 카톡에 붙여넣어 보내보세요.");
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-line bg-cream p-6">
      <p className="text-[15px] font-medium text-ink">친구에게 송영신목장 알리기</p>
      <p className="mt-1 text-[13px] leading-relaxed text-mute">
        소중한 분께 한 잔의 정직함을 권해보세요. 남은 자리는 선착순입니다.
      </p>
      <button
        onClick={onShare}
        aria-label="송영신목장 사이트를 친구에게 공유하기"
        className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep"
      >
        공유하기
      </button>
      {toast && (
        <p role="status" className="mt-3 text-[13px] text-gold-deep">
          {toast}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 계정 페이지에 배치**

`app/account/page.tsx` import에 추가:

```tsx
import { ShareButton } from "@/components/ShareButton";
```

프로필 카드 블록(`{profile && ( ... )}`, 약 289행)의 **닫는 `)}` 바로 아래**에 추가:

```tsx
      <ShareButton />
```

- [ ] **Step 3: 빌드/타입 확인**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: exit 0. `/account`는 클라이언트 페이지로 정상 빌드.

- [ ] **Step 4: Commit**

```bash
git add components/ShareButton.tsx app/account/page.tsx
git commit -m "feat: add member ShareButton on account page"
```

---

## Chunk 4: 통합 검증

### Task 12: 빌드 게이트 + 수동 검증

**Files:** 없음(검증만)

- [ ] **Step 1: 전체 빌드 게이트**

Run:
```bash
rm -rf .next && npx vitest run && npx tsc --noEmit && npx next build --webpack
```
Expected:
- vitest: 신규 포함 전부 PASS (기존 16 + schema + share)
- tsc: exit 0
- next build: exit 0, 홈(`/`)·제품(`/products/[id]`) 정적 유지, 라우트 목록에 `/robots.txt`·`/sitemap.xml` 존재

- [ ] **Step 2: 변경 파일 eslint**

Run: `npx eslint lib/seo lib/share.ts components/JsonLd.tsx components/ShareButton.tsx app/robots.ts app/sitemap.ts app/signup/layout.tsx app/order-once/layout.tsx`
Expected: 0 errors (신규 위반 없음)

- [ ] **Step 3: 빌드 산출물에 JSON-LD 포함 확인**

Run: `grep -ro 'application/ld+json' .next/server/app/index.html .next/server/app/page.html 2>/dev/null | head; grep -rl 'application/ld+json' .next/server/app 2>/dev/null | head`
Expected: 홈/제품 prerender HTML에 `application/ld+json` 스크립트 존재(경로는 Next 산출 구조에 따라 다를 수 있음 — 존재 여부만 확인).

- [ ] **Step 4: 수동 검증 체크리스트(배포 후, 사용자와 함께)**

- [ ] `https://shop.a2jerseymilk.com/robots.txt` → 200, sitemap 라인·AI 봇 규칙 포함
- [ ] `.../sitemap.xml` → 200, 공개 경로 + 제품 4종 URL
- [ ] `.../llms.txt` → 200, 마크다운 정상
- [ ] 구글 [리치 결과 테스트]에 홈·제품 URL 입력 → Organization/LocalBusiness/FAQ/Product 인식
- [ ] 실제 카톡으로 사이트 링크 전송 → OG 카드(og-default 이미지·제목·설명) 노출. (캐시되면 카카오/페이스북 디버거로 갱신)
- [ ] 휴대폰에서 `/account` 로그인 → "공유하기" → OS 공유 시트에서 카톡 선택 가능. 데스크톱에서는 "링크 복사됨" 토스트
- [ ] `/order-once` 단품 구매 경로 여전히 접근 가능(회귀 없음)

- [ ] **Step 5: (커밋 없음 — 검증 태스크)**

검증만 수행. 코드 변경이 발생하면 해당 Task로 돌아가 수정·커밋한다.

---

## 영향 파일 요약

**신규:** `lib/seo/faq.ts`, `lib/seo/schema.ts`, `lib/seo/schema.test.ts`, `lib/share.ts`, `lib/share.test.ts`, `components/JsonLd.tsx`, `components/ShareButton.tsx`, `app/robots.ts`, `app/sitemap.ts`, `app/signup/layout.tsx`, `app/order-once/layout.tsx`, `public/llms.txt`, `public/brand/og-default.jpg`

**수정:** `lib/site.ts`(SITE_URL), `app/layout.tsx`(metadataBase·OG·twitter·전역 JsonLd), `app/page.tsx`(JsonLd), `app/products/[id]/page.tsx`(JsonLd), `app/guide|terms|privacy/page.tsx`(canonical), `app/account/page.tsx`(ShareButton)

**범위 밖(별도 사이클):** 구독기간 4/8/12주 선택, 추적형 리퍼럴, 카카오 SDK, 동적 OG.
