# 스토어프론트 ↔ product_catalog 연동 설계

> 작성일 2026-06-01 · 상태: 설계(승인 대기)

## 1. 배경 / 문제

관리자(상품·재고 탭, `ProductAdminPanel`)는 `product_catalog`의 **가격(price)·노출(active)·재고(stock)** 를 수정할 수 있다. 그러나 스토어프론트는 `lib/products.ts`의 **정적 카탈로그**를 사용해 가격·노출을 그린다. 두 소스가 분리돼 있어:

- **정확성 버그(핵심)**: 주문 생성 RPC(`create_subscription_order`, `create_once_order`, `create_guest_once_order`)는 이미 `product_catalog` 가격으로 결제 금액을 계산한다. 따라서 관리자가 DB 가격을 바꾸면 **고객이 보는 가격(정적)** 과 **실제 청구 가격(DB)** 이 어긋난다.
- 관리자가 상품을 숨겨도(`active=false`) 스토어프론트에 그대로 노출된다.
- 재고 0(`stock=0`, 품절)이어도 구매가 가능하다.

## 2. 목표

관리자의 가격·노출·재고 변경이 **방문 시 실시간으로** 스토어프론트에 반영되고, 숨김·품절 상품은 **표시·결제흐름·서버** 모든 층에서 일관되게 차단된다.

### 비목표 (YAGNI)
- 재고 자동 차감(주문 시 stock--) 안 함 — 무통장입금 수기 운영, 관리자가 수동 관리.
- 페이지를 SSR/ISR로 전환하지 않음 — 콘텐츠는 SSG 유지, 상업 필드만 클라이언트 실시간.
- 마케팅 콘텐츠(스토리·스펙·이미지·라벨)를 DB로 이전하지 않음 — `lib/products.ts`에 유지.

## 3. 소스-오브-트루스 모델

| 필드 | 권위 소스 | 비고 |
|---|---|---|
| 스토리·스펙·이미지·카피·라벨 | `lib/products.ts` (정적) | 변경 없음 |
| `price` | `product_catalog` (DB) | 정적값은 **로딩 중 렌더 폴백** 전용 |
| `active` (노출) | `product_catalog` (DB) | row 없으면 노출로 간주(아래 불변조건 참고) |
| `stock` (재고) | `product_catalog` (DB) | `null`=무제한, `0`=품절 |
| `taxFree` | `lib/products.ts` | **범위 외(YAGNI)**: DB `tax_free` 컬럼은 표시에 연결하지 않음 |

### 불변조건 (INVARIANT)
모든 스토어프론트 상품(`lib/products.ts`의 4종)은 `product_catalog`에 **대응 row가 존재해야 한다**. 시드 데이터로 이미 보장됨. 정적 `price`는 카탈로그 로드 완료 전 **렌더 폴백**일 뿐이며, "row 없이 주문" 경로가 아니다 — 서버 주문 RPC는 active row가 없으면 예외를 던지므로(§7), row 누락은 곧 주문 불가다. 따라서 §4의 `row?` 폴백은 *클라이언트 표시 깜빡임 방지*용이지 데이터 일관성 계약이 아니다.

## 4. 데이터 접근 — `lib/storefront.ts` (신설, 클라이언트)

- **순수 로직과 React를 분리(테스트성)**: 머지/캐시 핵심 로직을 React 밖 순수 함수로 두고, 훅은 그 위 얇은 래퍼로 둔다. 모듈 레벨 Promise 캐시(공유 싱글톤)는 신규 코드 중 가장 위험하므로, 캐시 적재/에러/refetch 경로를 단위 테스트 가능하게 만든다(또는 수동 커버리지 명시).
- `useStorefrontCatalog()`: 방문 시 `product_catalog`를 anon 키로 1회 조회(모듈 레벨 Promise 캐시 + React state 공유). 기존 `catalog_select_all` RLS(true) 사용. 반환 `{ map: Map<id, CatalogRow>, loading: boolean, refresh: () => Promise<void> }`. `refresh`는 주문 거부(품절/숨김) 후 재조회용.
- `mergeProduct(staticProduct, row?) → LiveProduct`:
  ```
  LiveProduct = {
    ...staticProduct,
    price: row?.price ?? staticProduct.price,
    active: row ? row.active : true,
    stock: row?.stock ?? null,
    soldOut: row?.stock === 0,
    hidden: row ? !row.active : false,
  }
  ```
  불변 패턴(스프레드), 새 객체 반환.
- `visibleProducts(staticList, map) → LiveProduct[]`: 머지 후 `hidden` 제외(목록 컨텍스트용). soldOut은 포함(배지 표시).

## 5. UI 변경 (클라이언트 실시간, SSG 콘텐츠 유지)

### 5.1 `ProductShowcase.tsx` (홈 카드)
- `useStorefrontCatalog()` 사용. `visibleProducts`로 hidden 제외.
- 가격: `회원가`/`정가`를 라이브 가격 기준으로 표기. 로딩 중엔 정적 폴백.
- `soldOut`: "품절" 배지 + `구독 담기` 버튼 비활성.

### 5.2 `app/products/[id]/page.tsx` (상세, SSG 유지)
- 콘텐츠(히어로 카피·스토리·스펙·라벨·이미지)는 SSG 그대로.
- 상업 영역만 클라이언트 가드로 분리:
  - 히어로 **가격 라인** → 작은 클라이언트 컴포넌트가 라이브 가격 표시(로딩 중 정적 폴백).
  - **hidden** (active=false): 구매 영역을 "판매 중지 / 준비 중" 안내로 대체. (목록에서 이미 숨겨져 정상 동선에선 도달 안 함.)
  - **soldOut**: `PurchasePanel`이 품절 상태로 렌더(담기 비활성).

### 5.3 `PurchasePanel.tsx`
- 라이브 카탈로그 수신(prop 또는 훅). 본품 가격 + "함께 담기" addon 가격 모두 라이브.
- hidden addon 제외, soldOut addon 비활성/숨김.
- 본품 soldOut 또는 hidden → `구독 담기` 비활성 + 사유 표기.

## 6. 결제흐름 차단

- `app/order-once/page.tsx`, `lib/cart.tsx`(CartDrawer/checkout 경로): 라이브 머지로 hidden/soldout 상품의 **담기·결제 진입 차단**.
- **이미 담긴 항목의 재검증(단일 지점)**: 재검증은 **체크아웃 화면 진입 시점 1회**에 카탈로그를 재머지해 수행한다. 메커니즘:
  - 위반 라인아이템을 **개별로 플래그**(품절/판매중지 배지) 표시.
  - 위반 항목이 하나라도 있으면 **결제 제출 버튼 비활성** + 안내("품절/중지된 항목을 빼주세요"). 사용자가 해당 항목 제거 시 재계산되어 제출 가능.
  - 전체 차단이 아니라 *항목 단위* 처리.
- `PurchasePanel`의 addon이 세션 중 soldout/hidden으로 바뀌는 경우도 동일 원칙: addon 목록은 훅 값으로 매 렌더 재평가되어 hidden은 사라지고 soldout은 비활성 표기.
- 표시는 정적 폴백을 즉시 그리되, **구매 액션은 카탈로그 로드 완료 전까지 비활성**으로 잠가 stale 가격 주문을 방지.

## 7. 서버 강제 (신규 마이그레이션)

**현황 확인(리뷰 반영)**: 세 주문 경로의 가격 루프는 이미 `... where id = v_pid and active`로 조회하고, 미존재 시 `RAISE EXCEPTION '존재하지 않는 제품입니다'`를 던진다. 즉 **`active=false` 차단은 이미 서버에서 동작**한다(메시지만 오해의 소지). 또한 once/guest 경로는 래퍼가 아니라 **공유 헬퍼 `_create_once_order_core`**(`migration-guest-checkout.sql`)를 통한다.

따라서 패치 대상은 **3개 래퍼가 아니라 2개 함수**:
1. `_create_once_order_core` (단품 + 게스트 단품 공유)
2. `create_subscription_order`

`supabase/migration-storefront-catalog-guard.sql`: 위 2개 함수를 `CREATE OR REPLACE`로 패치.
- **신규**: 각 라인아이템에 대해 `stock = 0`이면 `RAISE EXCEPTION '품절된 상품입니다: %', v_pid`. (`stock IS NULL` = 무제한 → 통과.)
- **개선(선택)**: 기존 active 미존재 예외 메시지를 `'판매 중지되었거나 존재하지 않는 상품입니다'`로 명확화.
- 가격 조회 로직은 변경 없음. 시그니처·기존 로직 보존, **stock 검증만 추가(외과적)**.
- **주의**: 두 함수의 현재 본문을 먼저 정독(최신 재정의 추적: guest-checkout, order-integrity, shipping-always, discount/period 마이그레이션 체인)한 뒤 정확히 재작성.
- 마이그레이션은 사용자가 Supabase SQL Editor에서 수동 실행(기존 운영 방식과 동일).

## 7-1. 주문 거부의 클라이언트 표면화

`lib/orders.ts`는 RPC 에러 메시지를 그대로 rethrow한다. 주문 생성 catch 핸들러에서 거부 메시지(품절/판매중지)를 감지하면:
- `useStorefrontCatalog().refresh()`를 호출해 카탈로그 재조회 → 해당 상품이 즉시 품절/숨김 상태로 재렌더.
- 사용자에게 "해당 상품이 품절/중지되었습니다" 안내. (admin이 페이지 로드~제출 사이에 바꾼 레이스 케이스 대응.)
- **메시지 매칭 주의**: 거부는 세 변형으로 올 수 있다 — `품절된 상품입니다`(신규), `판매 중지되었거나 존재하지 않는 상품입니다`(active/미존재), 그 외 일반 오류. catch 핸들러는 앞 두 변형을 묶어 "재고/노출 거부"로 감지하고 `refresh()`를 트리거하되, 일반 오류와 구분한다.

## 8. Next.js 주의 (AGENTS.md)

수정된 Next 16. 새 서버 데이터패칭/캐싱 API는 도입하지 않음(클라이언트 훅 only)이라 위험 낮음. 구현 전 `node_modules/next/dist/docs/`에서 클라이언트 컴포넌트 ↔ SSG 상호작용 및 `"use client"` 경계를 확인한다.

## 9. 영향 파일

**신규**: `lib/storefront.ts`, `supabase/migration-storefront-catalog-guard.sql`, (필요 시) 상세 가격/가드용 소형 클라이언트 컴포넌트 1–2개.
**수정**: `components/ProductShowcase.tsx`, `app/products/[id]/page.tsx`, `components/PurchasePanel.tsx`, `app/order-once/page.tsx`, `lib/cart.tsx`(또는 checkout 경로), 필요 시 `lib/catalog.ts` 타입 재사용.

## 10. 테스트 / 검증

- 단위: `mergeProduct`(폴백·soldOut·hidden 분기), `visibleProducts`(hidden 제외), 캐시/머지 순수 로직(적재·에러·refetch) — TDD.
- 통합/수동: 관리자에서 가격 변경 → 홈·상세 즉시 반영. active off → 목록·상세 숨김/판매중지. stock 0 → 품절 배지·담기 비활성·결제 차단.
- 서버(red-green): **stock=0 차단이 신규**이므로 이것이 진짜 red→green 대상. (active 차단은 이미 통과 상태이므로 red 단계가 성립하지 않음 — 회귀 테스트로만 보존.)
- 완료 전 `rm -rf .next && tsc --noEmit && next build` + 관련 파일 eslint 0.

## 11. 리스크

- **가격 플래시**: 정적→DB 가격 전환 순간의 깜빡임. 구매 버튼을 로드 완료까지 비활성화해 stale 주문은 방지. 표시 깜빡임은 사용자가 "방문 시 실시간"을 선택해 수용.
- **RPC 재작성 위험**: 기존 함수 본문을 정확히 보존해야 함. 외과적 변경 + red-green 검증으로 완화.
