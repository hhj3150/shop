# 스토어프론트 ↔ product_catalog 연동 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자의 가격·노출·재고(`product_catalog`) 변경을 방문 시 실시간으로 스토어프론트에 반영하고, 숨김·품절 상품을 표시·결제흐름·서버 3층에서 일관 차단한다.

**Architecture:** 정적 콘텐츠(`lib/products.ts`)는 그대로 두고, 상업 필드(price·active·stock)만 클라이언트 훅(`useStorefrontCatalog`)이 `product_catalog`에서 읽어 머지한다. 순수 머지/판정 로직은 React에서 분리해 단위 테스트(vitest)로 검증한다. 서버는 주문 RPC 2개에 `stock=0` 차단을 추가한다.

**Tech Stack:** Next.js 16.2.6(webpack), React 19.2.4, TypeScript 5, Supabase(anon+RLS, SECURITY DEFINER RPC), Tailwind v4, vitest(신규).

**Spec:** `docs/superpowers/specs/2026-06-01-storefront-catalog-binding-design.md`

**전제(반드시 준수):**
- 불변성(스프레드, 뮤테이션 금지). 작은 파일. surgical 변경(요청 라인만).
- AGENTS.md: Next 코드 작성 전 `node_modules/next/dist/docs/` 관련 문서 확인.
- 완료 주장 전 항상 fresh `rm -rf .next && npx tsc --noEmit && npx next build` + 관련 파일 `npx eslint`.
- 커밋은 각 태스크 끝에. 푸시는 사용자가 명시할 때만.
- eslint 규칙: effect 내 동기 setState 금지(`.then(setX)`/async-IIFE+alive 가드 패턴 사용), 렌더 중 `Date.now()` 금지.

**파일 구조(결정):**
| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `lib/storefront-merge.ts` | 순수 머지/판정(`mergeProduct`,`visibleProducts`,`isCatalogRejection`) — import 없음(타입만) | 신규 |
| `lib/storefront-merge.test.ts` | 위 단위 테스트 | 신규 |
| `lib/storefront-cache.ts` | `createCatalogCache(fetcher)` — 주입형 Promise 캐시(load/refresh), React 비의존 | 신규 |
| `lib/storefront-cache.test.ts` | 캐시 적재·에러·refetch 단위 테스트 | 신규 |
| `lib/storefront.ts` | `"use client"` 훅 — 모듈 캐시 싱글톤 + supabase fetcher 주입 | 신규 |
| `vitest.config.ts` | vitest 설정(node env, `@` 별칭) | 신규 |
| `components/ProductShowcase.tsx` | 홈 카드: hidden 제외·라이브가격·품절 | 수정 |
| `components/PurchasePanel.tsx` | 본품/addon 라이브가격·품절·hidden | 수정 |
| `app/products/[id]/page.tsx` | 상세: 가격라인·구매영역 클라 가드 | 수정 |
| `components/ProductCommercial.tsx` | 상세 가격라인/판매중지 가드(클라) | 신규 |
| `app/order-once/page.tsx` | 단품 제품선택 hidden/soldout 차단 + 거부 표면화 | 수정 |
| `app/checkout/page.tsx` | 정기구독 체크아웃 진입 재검증 + 거부 표면화 | 수정 |
| `lib/orders.ts` | (확인만) 이미 `error.message` rethrow — 코드 변경 없음 | 확인 |
| `supabase/migration-storefront-catalog-guard.sql` | RPC 2개 stock 차단 | 신규 |

---

## Chunk 1: 기반 — vitest 설정 + 순수 머지 로직 (TDD)

### Task 1: vitest 도입

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`

- [ ] **Step 1: vitest 설치**

Run: `npm i -D vitest`
Expected: `vitest` devDependencies에 추가, 설치 성공.

- [ ] **Step 2: test 스크립트 추가**

`package.json`의 `"scripts"`에 추가(기존 키 보존, surgical):
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: vitest.config.ts 생성**

`@` 별칭을 프로젝트 루트로 매핑(소스의 `@/lib/...` import 해석용). React 불필요(순수 로직만) → node 환경.
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
```

- [ ] **Step 4: 빈 실행 확인**

Run: `npx vitest run`
Expected: "No test files found" 또는 0 tests — 설정이 로드되고 에러 없이 종료(exit 0 또는 "no tests"). 별칭/구성 오류 없음 확인.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: vitest 도입 — 순수 로직 단위 테스트 기반"
```

### Task 2: 순수 머지/판정 로직 (TDD)

**Files:**
- Create: `lib/storefront-merge.ts`
- Test: `lib/storefront-merge.test.ts`

참고: `lib/products.ts`의 `Product` 타입은 import 없는 순수 데이터 모듈이라 타입 import 안전. supabase에 의존하는 `lib/catalog.ts`는 import하지 않는다(테스트 격리).

- [ ] **Step 1: 실패 테스트 작성**

`lib/storefront-merge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mergeProduct, visibleProducts, isCatalogRejection, type CommercialRow } from "./storefront-merge";
import { PRODUCTS } from "@/lib/products";

const base = PRODUCTS[0]; // milk-180, price 3500
const row = (over: Partial<CommercialRow>): CommercialRow => ({
  id: base.id, price: 4000, stock: null, active: true, ...over,
});

describe("mergeProduct", () => {
  it("row 없으면 정적 가격 폴백, 노출·재고무제한", () => {
    const m = mergeProduct(base, undefined);
    expect(m.price).toBe(base.price);
    expect(m.active).toBe(true);
    expect(m.hidden).toBe(false);
    expect(m.soldOut).toBe(false);
    expect(m.stock).toBeNull();
  });
  it("row 있으면 DB 가격 사용", () => {
    expect(mergeProduct(base, row({ price: 4000 })).price).toBe(4000);
  });
  it("stock 0 → soldOut", () => {
    expect(mergeProduct(base, row({ stock: 0 })).soldOut).toBe(true);
  });
  it("stock null → soldOut 아님", () => {
    expect(mergeProduct(base, row({ stock: null })).soldOut).toBe(false);
  });
  it("active false → hidden", () => {
    expect(mergeProduct(base, row({ active: false })).hidden).toBe(true);
  });
  it("원본 불변(새 객체)", () => {
    const m = mergeProduct(base, row({ price: 9999 }));
    expect(base.price).toBe(3500);
    expect(m).not.toBe(base);
  });
});

describe("visibleProducts", () => {
  it("hidden 제외, soldOut은 포함", () => {
    const rows = new Map<string, CommercialRow>([
      [PRODUCTS[0].id, row({ id: PRODUCTS[0].id, active: false })],
      [PRODUCTS[1].id, row({ id: PRODUCTS[1].id, stock: 0 })],
    ]);
    const vis = visibleProducts(PRODUCTS, rows);
    expect(vis.find((p) => p.id === PRODUCTS[0].id)).toBeUndefined();
    expect(vis.find((p) => p.id === PRODUCTS[1].id)?.soldOut).toBe(true);
  });
});

describe("isCatalogRejection", () => {
  it("품절/판매중지/미존재 메시지를 거부로 감지", () => {
    expect(isCatalogRejection("품절된 상품입니다: milk-180")).toBe(true);
    expect(isCatalogRejection("판매 중지되었거나 존재하지 않는 상품입니다")).toBe(true);
    expect(isCatalogRejection("존재하지 않는 제품입니다: x")).toBe(true);
  });
  it("일반 오류는 false", () => {
    expect(isCatalogRejection("네트워크 오류")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/storefront-merge.test.ts`
Expected: FAIL — `Cannot find module './storefront-merge'`.

- [ ] **Step 3: 최소 구현**

`lib/storefront-merge.ts`:
```ts
// 스토어프론트 상업 필드 머지/판정 — React 비의존 순수 로직(단위 테스트 대상).
import type { Product } from "@/lib/products";

// product_catalog 중 스토어프론트가 쓰는 최소 상업 필드.
export type CommercialRow = {
  id: string;
  price: number;
  stock: number | null; // null=무제한, 0=품절
  active: boolean;
};

// 정적 Product + DB 상업 상태를 합친 표시용 모델.
export type LiveProduct = Product & {
  active: boolean;
  stock: number | null;
  soldOut: boolean;
  hidden: boolean;
};

// 정적 상품에 카탈로그 row를 머지(불변, 새 객체). row 없으면 정적 가격 폴백.
export function mergeProduct(product: Product, row?: CommercialRow): LiveProduct {
  return {
    ...product,
    price: row?.price ?? product.price,
    active: row ? row.active : true,
    stock: row?.stock ?? null,
    soldOut: row?.stock === 0,
    hidden: row ? !row.active : false,
  };
}

// 목록 컨텍스트용: 머지 후 hidden 제외(soldOut은 배지로 노출하므로 포함).
export function visibleProducts(
  products: Product[],
  rows: Map<string, CommercialRow>
): LiveProduct[] {
  return products
    .map((p) => mergeProduct(p, rows.get(p.id)))
    .filter((p) => !p.hidden);
}

// 주문 RPC 거부 메시지(품절/판매중지/미존재)를 재고·노출 거부로 감지.
const REJECTION_MARKERS = ["품절된 상품", "판매 중지", "존재하지 않는"];
export function isCatalogRejection(message: string): boolean {
  return REJECTION_MARKERS.some((m) => message.includes(m));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/storefront-merge.test.ts`
Expected: PASS — 모든 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add lib/storefront-merge.ts lib/storefront-merge.test.ts
git commit -m "feat: 스토어프론트 상업필드 머지 순수 로직 + 단위 테스트"
```

### Task 3: 주입형 카탈로그 캐시 (TDD)

**Files:**
- Create: `lib/storefront-cache.ts`
- Test: `lib/storefront-cache.test.ts`

스펙 §4가 가장 위험하다고 지목한 모듈 Promise 캐시(적재·에러·refetch)를 **fetcher 주입형 순수 팩토리**로 만들어 React/Supabase 없이 단위 테스트한다. 훅(아래 Step 6, `lib/storefront.ts`)은 이 팩토리에 supabase fetcher를 주입한 모듈 싱글톤만 감싼다.

- [ ] **Step 1: 실패 테스트 작성**

`lib/storefront-cache.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createCatalogCache } from "./storefront-cache";
import type { CommercialRow } from "./storefront-merge";

const m = (over: Partial<CommercialRow> = {}): Map<string, CommercialRow> =>
  new Map([["milk-180", { id: "milk-180", price: 3500, stock: null, active: true, ...over }]]);

describe("createCatalogCache", () => {
  it("load는 fetcher를 1회만 호출하고 결과를 공유한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(m());
    const cache = createCatalogCache(fetcher);
    const [a, b] = await Promise.all([cache.load(), cache.load()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("실패 시 캐시를 비워 다음 load가 재시도한다", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce(m());
    const cache = createCatalogCache(fetcher);
    await expect(cache.load()).rejects.toThrow("net");
    const ok = await cache.load(); // 재시도 성공
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ok.get("milk-180")?.price).toBe(3500);
  });

  it("refresh는 캐시를 무효화하고 새로 적재한다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(m({ price: 3500 }))
      .mockResolvedValueOnce(m({ price: 4000 }));
    const cache = createCatalogCache(fetcher);
    expect((await cache.load()).get("milk-180")?.price).toBe(3500);
    const refreshed = await cache.refresh();
    expect(refreshed.get("milk-180")?.price).toBe(4000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/storefront-cache.test.ts`
Expected: FAIL — `Cannot find module './storefront-cache'`.

- [ ] **Step 3: 최소 구현**

`lib/storefront-cache.ts`:
```ts
// 카탈로그 Promise 캐시 — fetcher 주입형(React/Supabase 비의존, 단위 테스트 대상).
//   load: 최초 1회만 fetcher 호출 후 공유. 실패 시 캐시 비워 재시도 허용.
//   refresh: 캐시 무효화 후 재적재(주문 거부 뒤 사용).
import type { CommercialRow } from "@/lib/storefront-merge";

export type CatalogMap = Map<string, CommercialRow>;
export type CatalogFetcher = () => Promise<CatalogMap>;

export function createCatalogCache(fetcher: CatalogFetcher) {
  let cache: Promise<CatalogMap> | null = null;

  function load(): Promise<CatalogMap> {
    if (!cache) {
      cache = fetcher().catch((e) => {
        cache = null; // 실패 시 비워 다음 load에 재시도
        throw e;
      });
    }
    return cache;
  }

  function refresh(): Promise<CatalogMap> {
    cache = null;
    return load();
  }

  return { load, refresh };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/storefront-cache.test.ts`
Expected: PASS — 3개 테스트 통과.

- [ ] **Step 5: Commit**

```bash
git add lib/storefront-cache.ts lib/storefront-cache.test.ts
git commit -m "feat: 주입형 카탈로그 캐시(load/refresh) + 단위 테스트"
```

**Task 3 (계속) — 클라이언트 카탈로그 훅** (`lib/storefront.ts`, 신규). 훅 자체는 얇은 래퍼(캐시 적재/에러/refetch는 위 단위 테스트로 커버). 컴파일·lint로 검증.

- [ ] **Step 6: 훅 구현**

`lib/storefront.ts`:
```ts
"use client";

// 스토어프론트용 product_catalog 라이브 조회 훅. 방문 시 1회 조회, 모듈 캐시 싱글톤으로 공유.
//   상업 필드(price·stock·active)만 읽는다. 거부 후 refresh()로 재조회.
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { CommercialRow } from "@/lib/storefront-merge";
import { createCatalogCache, type CatalogMap } from "@/lib/storefront-cache";

async function fetchCommercial(): Promise<CatalogMap> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("product_catalog")
    .select("id, price, stock, active");
  if (error) throw error;
  const map: CatalogMap = new Map();
  for (const r of (data as CommercialRow[]) ?? []) map.set(r.id, r);
  return map;
}

// 모듈 싱글톤 — 방문 전체에서 1회 조회 공유.
const catalogCache = createCatalogCache(fetchCommercial);

export function useStorefrontCatalog() {
  const [map, setMap] = useState<CatalogMap>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    catalogCache
      .load()
      .then((m) => {
        if (alive) {
          setMap(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false); // 실패해도 정적 폴백으로 동작
      });
    return () => {
      alive = false;
    };
  }, []);

  // 주문 거부(품절/숨김) 후 강제 재조회.
  async function refresh() {
    const m = await catalogCache.refresh();
    setMap(m);
  }

  return { map, loading, refresh };
}
```

- [ ] **Step 7: 컴파일·lint 검증**

Run: `npx tsc --noEmit && npx eslint lib/storefront.ts`
Expected: 0 errors. (effect 내 `.then(setState)`는 비동기 콜백이라 set-state-in-effect 규칙 비위반 — 기존 `reloadSubs` 패턴과 동일.)

- [ ] **Step 8: Commit**

```bash
git add lib/storefront.ts
git commit -m "feat: useStorefrontCatalog — 카탈로그 라이브 조회 훅(캐시 싱글톤)"
```

---

## Chunk 2: 스토어프론트 표시 (홈·상세·PurchasePanel)

검증은 tsc/build/eslint + 수동(자동 테스트 없음). 각 태스크 끝 fresh 검증.

### Task 4: 홈 카드 (ProductShowcase)

**Files:**
- Modify: `components/ProductShowcase.tsx`

현재: `PRODUCTS`를 직접 map, `회원가 {subscribePrice(p.price)}`·`정가 {p.price}` 표기, "구독 신청"은 상세로 가는 `<Link>`(직접 담기 아님).

> **참고(리뷰 반영):** 스펙 §5.1은 "구독 담기 버튼 비활성"이라 적었으나 실제 카드에는 담기 버튼이 없고 상세로 가는 `<Link>`("구독 신청")만 있다. 따라서 soldOut 처리는 그 `<Link>`를 비활성 "품절" 표시로 교체하는 것으로 갈음한다(Step 2). 가격 텍스트(회원가/정가, 현 107–112행 영역)는 `p.price`가 이제 라이브라 **별도 수정 불필요** — 자동 반영된다.

- [ ] **Step 1: 훅 도입 + 머지**

상단 import에 추가:
```ts
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";
```
컴포넌트 본문에서 훅 호출, `shown` 계산을 라이브 머지로 교체:
```ts
const { map } = useStorefrontCatalog();
const live = visibleProducts(PRODUCTS, map);
const shown = filter === "all" ? live : live.filter((p) => p.line === filter);
```
(주의: `live`는 `LiveProduct[]`라 기존 `p.accent`,`p.badge` 등 모든 Product 필드 유지됨. `p.price`는 이제 라이브 가격.)

- [ ] **Step 2: 품절 표기**

카드 가격 블록(현재 107–112행 영역)에서, soldOut이면 "품절" 배지를 추가하고 "구독 신청" 링크를 품절 표시로 바꾼다. surgical하게:
- 가격 문단 아래 또는 badge 옆에 soldOut 배지:
```tsx
{p.soldOut && (
  <span className="mt-2 inline-block rounded-full bg-ink/10 px-2.5 py-1 text-[12px] text-mute">
    품절
  </span>
)}
```
- "구독 신청" 버튼: soldOut일 때 비활성 스타일 + 라벨 "품절"로. `<Link>`를 조건부로 교체:
```tsx
{p.soldOut ? (
  <span className="w-full cursor-not-allowed rounded-full bg-ink/15 px-6 py-3 text-center text-[15px] font-medium text-mute">
    품절
  </span>
) : (
  <Link href={`/products/${p.id}`} className="w-full rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-cream transition-transform hover:scale-[1.03] active:scale-[0.98]">
    구독 신청
  </Link>
)}
```

- [ ] **Step 3: 검증**

Run: `rm -rf .next && npx tsc --noEmit && npx eslint components/ProductShowcase.tsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/ProductShowcase.tsx
git commit -m "feat: 홈 카드 라이브 가격·노출·품절 반영"
```

### Task 5: 상세 가격라인·판매중지 가드 (ProductCommercial)

**Files:**
- Create: `components/ProductCommercial.tsx`
- Modify: `app/products/[id]/page.tsx`

상세 페이지는 SSG 서버 컴포넌트. 가격 라인(현재 85–90행)과 구매 영역을 클라이언트 가드로 분리한다. SSG 콘텐츠/스토리/스펙/라벨은 그대로 유지.

- [ ] **Step 1: ProductCommercial 클라이언트 컴포넌트 생성**

상세 히어로의 "회당 ₩가격 · 회원 10–15%(기간별 4주 10%·8주 12%·12주 15%)" 라인을 라이브 가격으로 그리고, hidden이면 "판매 중지" 안내를 노출하는 작은 클라이언트 컴포넌트.
```tsx
"use client";

// 상세 페이지 상업 가드: 라이브 가격 라인 + 숨김(active=false) 시 판매중지 안내.
//   콘텐츠(SSG)는 서버에서 그대로 렌더하고, 가격/노출만 이 컴포넌트가 클라이언트에서 보정.
import { formatKRW, type Product } from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function ProductHeroPrice({ product, maxRate }: { product: Product; maxRate: number }) {
  const { map } = useStorefrontCatalog();
  const live = mergeProduct(product, map.get(product.id));
  return (
    <p className="mt-6 text-[14px] text-ink-soft">
      회당{" "}
      <span className="font-medium tabular-nums text-ink">{formatKRW(live.price)}</span>
      <span className="mx-2 text-line">·</span>
      <span className="text-gold-deep">창립 500인 회원 특권 −{maxRate}%</span>
      {live.soldOut && <span className="ml-2 text-mute">· 품절</span>}
    </p>
  );
}
```
(hidden 처리는 Task 6의 PurchasePanel 가드에서 — 구매 영역 자체를 막는다. 히어로 가격은 hidden이어도 표시되나 도달 동선이 차단됨. 단, 추가로 hidden 시 상단에 배너를 원하면 별도 컴포넌트로. 본 계획은 구매영역 차단으로 충분.)

- [ ] **Step 2: page.tsx에서 가격 라인 교체**

`app/products/[id]/page.tsx`:
- import 추가: `import { ProductHeroPrice } from "@/components/ProductCommercial";`
- 현재 85–90행의 `<p className="mt-6 ...">회당 ... </p>` 블록을 `<ProductHeroPrice product={product} maxRate={maxRate} />`로 교체.
- 서버 컴포넌트에 클라이언트 컴포넌트 임베드는 정상(경계 OK). **작성 전 `node_modules/next/dist/docs/`에서 server→client 컴포넌트 경계 확인.**

- [ ] **Step 3: 검증**

Run: `rm -rf .next && npx tsc --noEmit && npx eslint components/ProductCommercial.tsx app/products/[id]/page.tsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add components/ProductCommercial.tsx "app/products/[id]/page.tsx"
git commit -m "feat: 상세 히어로 라이브 가격·품절 표기"
```

### Task 6: PurchasePanel 라이브 가격·품절·hidden

**Files:**
- Modify: `components/PurchasePanel.tsx`

현재: `product.price`로 본품, `const addons = PRODUCTS.filter(...)`(35행) addon들의 `.price` 사용. `addons`는 **네 곳**에서 쓰인다 — `extrasPerDelivery`(42행), `origPerDelivery`(51행), `handleAdd` forEach(68행), `addons.map` 렌더(199행). 모두 라이브로 교체하고, 본품 soldOut/hidden 시 담기 비활성, hidden addon 제외·soldout addon 비활성.

> **주의(리뷰 반영):** `addons.map`만 바꾸면 가격합(42·51행)과 담기(68행)는 여전히 정적 `PRODUCTS`(hidden 포함)를 순회한다 → hidden addon이 금액·장바구니에 새어든다. 반드시 **선언 자체를 `liveAddons`로 재배정**해 네 곳이 한 번에 갱신되게 한다.

- [ ] **Step 1: 훅·머지 도입 + addons 재배정**

import 추가:
```ts
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct, visibleProducts } from "@/lib/storefront-merge";
```
본문 — 35행의 `const addons = PRODUCTS.filter((p) => p.id !== product.id);`를 다음으로 교체:
```ts
const { map, loading: catalogLoading } = useStorefrontCatalog();
const liveMain = mergeProduct(product, map.get(product.id));
// 함께 담기 후보: hidden 제외(soldOut은 비활성 표기). 본품은 제외.
//   이름을 그대로 addons로 두어 42·51·68·199행 네 사용처가 한 번에 라이브로 갱신된다.
const addons = visibleProducts(PRODUCTS, map).filter((p) => p.id !== product.id);
```
- 본품 가격 계산에서 `product.price` → `liveMain.price`로 교체: `unitPrice`(40행)와 `origPerDelivery`의 `product.price * qty`(50행).
- `addons`는 이제 `LiveProduct[]`라 42·51·68·199행은 그대로 두면 라이브 가격으로 동작(`p.price`가 라이브, hidden은 이미 빠짐). 추가로 199행 렌더에서 `p.soldOut`이면 +버튼 비활성 + "품절" 표기(Step 3).

- [ ] **Step 2: 담기 버튼 가드**

`구독 담기` 버튼을 본품 soldOut/hidden 또는 카탈로그 로딩 중이면 비활성:
```tsx
<button
  onClick={handleAdd}
  disabled={catalogLoading || liveMain.soldOut || liveMain.hidden}
  className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
>
  {liveMain.hidden ? "판매 중지" : liveMain.soldOut ? "품절" : catalogLoading ? "확인 중…" : "구독 담기"}
</button>
```
(stale 가격 주문 방지를 위해 로딩 중 비활성 — 스펙 §6.)

- [ ] **Step 3: addon 품절 처리**

addon `<li>`의 + 버튼 `disabled`에 `|| p.soldOut` 추가, 가격 옆에 `{p.soldOut && <span className="text-mute">품절</span>}`.

- [ ] **Step 4: 검증**

Run: `rm -rf .next && npx tsc --noEmit && npx eslint components/PurchasePanel.tsx`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/PurchasePanel.tsx
git commit -m "feat: 구매 패널 라이브 가격·품절·판매중지 가드"
```

---

## Chunk 3: 결제흐름 차단 + 서버 강제

### Task 7: 결제 진입 재검증 (단품 + 정기구독)

**Files:**
- Modify: `app/order-once/page.tsx` (단품/게스트 — 제품 선택 + 제출 지점)
- Modify: `app/checkout/page.tsx` (정기구독 — 장바구니 항목 + 제출 지점)

> **중요(리뷰 반영):** 정기구독 주문은 `lib/cart.tsx`/`CartDrawer`가 아니라 **`app/checkout/page.tsx`**에서 제출된다(`createOrder` 137행, 제출 버튼 `disabled={busy || belowMin}` 351행). `CartDrawer`는 `/checkout`로 라우팅만 한다. 따라서 재검증 대상은 **order-once + checkout 두 페이지**다.

스펙 §6: 재검증은 **체크아웃 진입 시 1회**(렌더 시 라이브 머지). 위반 항목 개별 플래그 + 위반 있으면 제출 비활성. 패턴은 Task 6과 동일(훅→머지→disabled).

- [ ] **Step 1: order-once 제품 선택 차단**

`app/order-once/page.tsx`:
- import 추가:
  ```ts
  import { useStorefrontCatalog } from "@/lib/storefront";
  import { mergeProduct, visibleProducts } from "@/lib/storefront-merge";
  ```
- `OrderOnce()` 본문 상단에 훅: `const { map, loading: catalogLoading } = useStorefrontCatalog();`
- 제품 목록(287행 `PRODUCTS.map`)을 `visibleProducts(PRODUCTS, map)`로 교체(hidden 제외). 각 항목을 `mergeProduct`로 평가해 `p.soldOut`이면 +버튼(`setQty`) 비활성 + "품절" 표기, 가격 표기(307행 `p.price`)는 라이브 `p.price` 사용.
- 합계 계산(`subtotal` 104행, `count` 109행, items 빌드 187행)도 `visibleProducts(PRODUCTS, map)` 기준으로 평가해 hidden 제품 수량이 합계·주문에 들어가지 않게 한다. (soldout은 표시되나 수량 0 강제는 아님 — 제출 시 서버가 차단; 단 UI에서 +버튼 비활성으로 신규 추가는 막음.)
- 제출 버튼(438행 `disabled={busy || belowMin || count === 0}`)에 `|| catalogLoading` 추가(stale 가격 주문 방지, 스펙 §6).

- [ ] **Step 2: checkout 장바구니 항목 재검증**

`app/checkout/page.tsx`:
- 동일 import + 훅(`const { map } = useStorefrontCatalog();`).
- 주문 요약 항목 렌더(227행 `items.map`, `getProduct(item.productId)`)에서 각 항목을 `mergeProduct(p, map.get(p.id))`로 평가해 `hidden || soldOut`이면 배지("판매 중지"/"품절") 표시.
- 위반 항목이 하나라도 있으면 플래그 계산: `const hasBlocked = items.some((it) => { const p = getProduct(it.productId); const lp = p && mergeProduct(p, map.get(p.id)); return !!lp && (lp.hidden || lp.soldOut); });`
- 제출 버튼(351행 `disabled={busy || belowMin}`)에 `|| hasBlocked` 추가 + 위반 시 안내 문단("품절·판매중지된 항목을 빼주세요").

- [ ] **Step 3: 검증**

Run: `rm -rf .next && npx tsc --noEmit && npx eslint app/order-once/page.tsx app/checkout/page.tsx`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/order-once/page.tsx app/checkout/page.tsx
git commit -m "feat: 결제 진입 시 품절·판매중지 항목 재검증·차단(단품·구독)"
```

### Task 8: 주문 거부 메시지 표면화

**Files:**
- Modify: `app/checkout/page.tsx` (정기구독 catch — 현 183–185행)
- Modify: `app/order-once/page.tsx` (단품/게스트 catch — 현 241–243행)

`lib/orders.ts`는 이미 세 래퍼 모두 `error.message`를 rethrow(확인됨, 코드 변경 없음). 두 페이지의 `onSubmit` catch 블록을 거부 감지로 보강한다. Task 7에서 두 페이지 모두 `const { map, loading: catalogLoading } = useStorefrontCatalog();`를 이미 호출하므로, **그 기존 구조분해에 `refresh`만 추가**한다(`const { map, loading: catalogLoading, refresh } = useStorefrontCatalog();`). 훅을 두 번 호출하지 말 것.

각 페이지 현재 catch:
```ts
} catch (err) {
  setError(err instanceof Error ? err.message : "주문에 실패했습니다.");
}
```
를 다음으로 교체:
```ts
} catch (err) {
  const msg = err instanceof Error ? err.message : "주문에 실패했습니다.";
  if (isCatalogRejection(msg)) {
    await refresh(); // 카탈로그 재조회 → 품절/숨김 즉시 반영(Task 7 머지가 항목 플래그·제출 비활성화)
    setError("해당 상품이 품절되었거나 판매 중지되었습니다. 장바구니를 확인해 주세요.");
  } else {
    setError(msg);
  }
}
```
import 추가(두 파일): `import { isCatalogRejection } from "@/lib/storefront-merge";`

- [ ] **Step 1: 두 페이지 catch 보강 + `refresh` 구조분해 추가** (위 패턴 적용)
- [ ] **Step 2: 검증** — `rm -rf .next && npx tsc --noEmit && npx eslint app/checkout/page.tsx app/order-once/page.tsx` → 0 errors
- [ ] **Step 3: Commit**
```bash
git add app/checkout/page.tsx app/order-once/page.tsx
git commit -m "feat: 주문 거부(품절·중지) 시 카탈로그 새로고침·안내"
```

### Task 9: 서버 강제 — stock=0 차단 마이그레이션

**Files:**
- Create: `supabase/migration-storefront-catalog-guard.sql`

**중요(스펙 §7):** `active` 차단은 이미 동작(`where id = v_pid and active`). **신규는 `stock=0` 차단뿐.** 패치 대상은 2함수: `_create_once_order_core`(단품+게스트 공유)와 `create_subscription_order`. once/guest 래퍼는 건드리지 않는다.

- [ ] **Step 1: 현재 함수 본문 확보(권위)**

두 함수는 여러 마이그레이션에 걸쳐 **본문이 갈라지며** 재정의됨. **라이브 DB 정의가 유일한 권위 소스**다:
- **반드시 먼저** Supabase에서 현재 정의를 조회: `select pg_get_functiondef('public._create_once_order_core(uuid,jsonb,jsonb)'::regprocedure);` 및 `create_subscription_order`의 실제 시그니처로 동일 조회. 이 출력을 그대로 베이스로 삼는다.
- **파일 mtime이나 이 계획이 나열한 체인 순서를 신뢰하지 말 것** — 리뷰에서 `order-integrity.sql`/`schema.sql`이 `min-order-25k.sql`보다 mtime이 더 최신으로 나오는 등 파일 추론이 라이브 상태와 어긋남을 확인했다. DB 접근이 불가능할 때만 파일로 폴백하고, 그 경우 **적용 순서를 사용자에게 확인**한다.
- 다행히 두 함수의 가격 루프는 정의 버전과 무관하게 `select price into v_price from public.product_catalog where id = v_pid and active;` + `if not found then raise ...` 형태로 동일하므로, stock 가드 삽입 지점은 어느 버전이든 같다.

- [ ] **Step 2: stock 가드 삽입(외과적)**

각 함수의 가격 조회 루프 안, **가격 조회 직후**에 stock 확인을 추가. **현재 본문 전체를 보존**한다.
- (a) 함수 최상단 `declare` 블록에 변수 선언을 추가: `v_stock integer;` (인라인 mid-body `declare`는 PL/pgSQL에서 별도 `BEGIN…DECLARE…END` 서브블록 없이는 불가 — 반드시 기존 최상단 declare 블록에 넣는다).
- (b) 루프 내 `select price into v_price ... where id = v_pid and active;` **바로 다음**에:
  ```sql
  -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과.
  select stock into v_stock from public.product_catalog where id = v_pid and active;
  if v_stock = 0 then
    raise exception '품절된 상품입니다: %', v_pid;
  end if;
  ```
(루프 변수명은 기존 `v_price`/`v_pid`에 맞춘다. active 미존재 예외 메시지는 선택적으로 `'판매 중지되었거나 존재하지 않는 상품입니다: %'`로 개선 가능 — `isCatalogRejection`의 "판매 중지"·"존재하지 않는" 마커와 정합.)

마이그레이션 파일은 두 함수의 **완전한 `CREATE OR REPLACE FUNCTION ...`** (보존된 본문 + stock 가드)로 구성. 시그니처·권한(grant/revoke) 동일 유지.

- [ ] **Step 3: SQL 문법 검증**

가능하면 로컬/스테이징 DB에 적용해 문법·동작 확인. red-green:
- (red) stock=0인 상품으로 주문 RPC 호출 → 예외 발생 확인.
- (green) stock=null/양수로 되돌리면 정상.
- active=false는 기존부터 차단(회귀 확인만).
DB 직접 접근이 없으면, 사용자에게 Supabase SQL Editor 적용을 요청하고 위 시나리오로 확인 요청.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-storefront-catalog-guard.sql
git commit -m "feat: 주문 RPC에 재고 0(품절) 서버 차단 추가"
```

### Task 10: 전체 통합 검증

- [ ] **Step 1: 풀 빌드 + 테스트**

Run: `rm -rf .next && npx vitest run && npx tsc --noEmit && npx next build`
Expected: vitest 전체 PASS, tsc exit 0, build "Compiled successfully" + 전 페이지 생성.

- [ ] **Step 2: eslint 전수**

Run: `npx eslint lib/storefront.ts lib/storefront-cache.ts lib/storefront-merge.ts components/ProductShowcase.tsx components/ProductCommercial.tsx components/PurchasePanel.tsx "app/products/[id]/page.tsx" app/order-once/page.tsx app/checkout/page.tsx`
Expected: 0 errors.

- [ ] **Step 3: 수동 시나리오(사용자/dev 서버)**

`npm run dev` 후:
1. 관리자 상품·재고 탭에서 milk-180 가격 변경 → 홈·상세에서 즉시 반영.
2. yogurt-500 `active=false` → 홈·상세 목록에서 사라짐, 직접 URL 진입 시 구매 비활성.
3. milk-750 `stock=0` → 홈·상세 "품절" 배지, 담기 비활성, 결제 진입 차단.
4. 장바구니에 담은 뒤 관리자가 품절 처리 → 체크아웃에서 해당 항목 플래그 + 제출 비활성.
5. (서버) 강제로 품절 상품 주문 시도 → RPC 예외 + 안내 + 카탈로그 새로고침.

- [ ] **Step 4: 최종 커밋(있을 경우)** 및 사용자에게 마이그레이션 적용 안내.

---

## 마이그레이션 적용 안내(사용자 수기)

`supabase/migration-storefront-catalog-guard.sql`를 Supabase SQL Editor에서 실행해야 서버 차단이 적용됨(기존 ERP 마이그레이션과 동일 운영 방식).
