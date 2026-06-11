# 방문수령 / 택배 선택 기능 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단품·정기구독 결제에서 `택배`/`방문수령`을 선택하게 하고, 방문수령이면 배송비를 0원으로 한다.

**Architecture:** 순수 로직(수령방법 타입·배송비 헬퍼·발송명단 제외)을 `lib/`에 두고 TDD로 고정한다. 서버 권위는 신규 SQL 마이그레이션이 4개 주문생성 RPC(단품·회원구독·게스트단품·갱신)에 조건부 배송비/검증완화를 추가한다. 프론트는 공용 `DeliveryMethodSelect`로 두 결제 페이지를 통합한다.

**Tech Stack:** Next.js(App Router) + TypeScript + Supabase(Postgres RPC) + Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-pickup-delivery-option-design.md`

---

## File Structure

신규:
- `lib/delivery-method.ts` — `DeliveryMethod` 타입·상수·검증·배송비 헬퍼(순수). TDD.
- `lib/delivery-method.test.ts` — 위 테스트.
- `components/DeliveryMethodSelect.tsx` — 라디오 + 방문 안내 박스(공용 UI).
- `supabase/migration-pickup-delivery.sql` — 컬럼 추가 + 4 RPC 패치.

수정:
- `lib/site.ts` — `FARM_HOURS` 상수.
- `components/VisitStore.tsx` — 하드코딩 영업시간 → `FARM_HOURS`.
- `lib/delivery-roster.ts` — `RosterOrderFields.delivery_method` + 방문수령 제외.
- `lib/delivery-roster.test.ts` — 제외 테스트(신규 파일).
- `lib/orders.ts` — `ShippingInfo.deliveryMethod` + `shipPayload`.
- `app/checkout/page.tsx` — state·계산·UI·백필·선물 가드(구독).
- `app/order-once/page.tsx` — 동일(단품).
- `app/account/RenewalForm.tsx` — 견적 배송비 0 표기.
- `app/admin/page.tsx` — `OrderRow.delivery_method` + 뱃지.
- `app/api/notify/route.ts` — 입금확인 SMS 방문수령 분기.

> **드리프트 주의(#53 교훈):** SQL은 prod에 수동 적용된다. Chunk 2 적용 전 `select pg_get_functiondef(...)`로 prod 실제 정의를 확인하고, 마이그레이션 함수 본문을 그 기준으로 맞춘다. 본 계획의 SQL diff는 in-repo 최신 정의(`migration-order-idempotency.sql`, `migration-renewal-modify.sql`) 기준이다.

---

## Chunk 1: 순수 로직 (TDD)

### Task 1: `lib/delivery-method.ts` — 타입·검증·배송비 헬퍼

**Files:**
- Create: `lib/delivery-method.ts`
- Test: `lib/delivery-method.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// lib/delivery-method.test.ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DELIVERY_METHOD,
  isPickup,
  parseDeliveryMethod,
  onceShippingFor,
  subShippingFor,
} from "./delivery-method";

describe("수령방법 기본·판정", () => {
  it("기본은 택배", () => {
    expect(DEFAULT_DELIVERY_METHOD).toBe("택배");
  });
  it("isPickup은 방문수령일 때만 true", () => {
    expect(isPickup("방문수령")).toBe(true);
    expect(isPickup("택배")).toBe(false);
  });
});

describe("경계 검증 parseDeliveryMethod", () => {
  it("방문수령만 방문수령, 그 외(잘못된 값·null)는 택배로 폴백", () => {
    expect(parseDeliveryMethod("방문수령")).toBe("방문수령");
    expect(parseDeliveryMethod("택배")).toBe("택배");
    expect(parseDeliveryMethod("pickup")).toBe("택배");
    expect(parseDeliveryMethod(null)).toBe("택배");
    expect(parseDeliveryMethod(undefined)).toBe("택배");
  });
});

describe("단품 배송비 onceShippingFor", () => {
  it("방문수령이면 0", () => {
    expect(onceShippingFor("방문수령", 24000, "06000")).toBe(0);
    expect(onceShippingFor("방문수령", 24000, "63000")).toBe(0); // 제주여도 0
  });
  it("택배면 일반 4,000 / 특수지역 5,000", () => {
    expect(onceShippingFor("택배", 24000, "06000")).toBe(4000);
    expect(onceShippingFor("택배", 24000, "63000")).toBe(5000); // 제주
  });
});

describe("구독 배송비 subShippingFor (기간 전체)", () => {
  it("방문수령이면 0(주수 무관)", () => {
    expect(subShippingFor("방문수령", 24000, "06000", 8)).toBe(0);
  });
  it("택배면 회당 택배비 × 주수", () => {
    expect(subShippingFor("택배", 24000, "06000", 8)).toBe(4000 * 8);
    expect(subShippingFor("택배", 24000, "63000", 4)).toBe(5000 * 4); // 제주
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/delivery-method.test.ts`
Expected: FAIL (모듈 없음 / export 없음).

- [ ] **Step 3: 최소 구현**

```ts
// lib/delivery-method.ts
// 수령방법: 택배(기본) | 방문수령. 방문수령은 배송비 0(목장 직접 수령).
import { onceShippingFee, subShippingFee } from "./products";

export const DELIVERY_METHODS = ["택배", "방문수령"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const DEFAULT_DELIVERY_METHOD: DeliveryMethod = "택배";

export function isPickup(method: DeliveryMethod): boolean {
  return method === "방문수령";
}

// 경계 검증: 외부(폼·쿼리·RPC 페이로드) 입력은 신뢰하지 않는다. 모르면 택배.
export function parseDeliveryMethod(value: unknown): DeliveryMethod {
  return value === "방문수령" ? "방문수령" : "택배";
}

// 단품 배송비: 방문수령이면 0, 아니면 지역별 택배비.
export function onceShippingFor(
  method: DeliveryMethod,
  subtotal: number,
  postcode?: string | null
): number {
  return isPickup(method) ? 0 : onceShippingFee(subtotal, postcode);
}

// 구독 배송비(기간 전체): 방문수령이면 0, 아니면 회당 택배비 × 주수.
export function subShippingFor(
  method: DeliveryMethod,
  perDeliveryListTotal: number,
  postcode: string | null | undefined,
  weeks: number
): number {
  return isPickup(method) ? 0 : subShippingFee(perDeliveryListTotal, postcode) * weeks;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/delivery-method.test.ts`
Expected: PASS (전체).

- [ ] **Step 5: 커밋**

```bash
git add lib/delivery-method.ts lib/delivery-method.test.ts
git commit -m "feat: 수령방법(택배/방문수령) 순수 로직 + 배송비 헬퍼"
```

### Task 2: `lib/site.ts` `FARM_HOURS` + `VisitStore.tsx` 중복 제거

**Files:**
- Modify: `lib/site.ts` (BUSINESS 아래에 상수 추가)
- Modify: `components/VisitStore.tsx:2,45`

- [ ] **Step 1: 상수 추가** — `lib/site.ts` 의 `BUSINESS` 블록 바로 아래에:

```ts
// 목장 판매장 영업시간(방문 안내·VisitStore 공용 단일 출처).
export const FARM_HOURS = "월–금 09:00–18:00";
```

- [ ] **Step 2: VisitStore 교체** — `components/VisitStore.tsx`
  - import 수정(line 2): `import { CAFE_HOME, BUSINESS, FARM_HOURS } from "@/lib/site";`
  - line 45 `<dd className="text-ink-soft">월–금 09:00–18:00</dd>` → `<dd className="text-ink-soft">{FARM_HOURS}</dd>`

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add lib/site.ts components/VisitStore.tsx
git commit -m "refactor: 목장 영업시간 FARM_HOURS 상수로 추출(중복 제거)"
```

### Task 3: `lib/delivery-roster.ts` — 방문수령 발송명단 제외 (TDD)

**Files:**
- Modify: `lib/delivery-roster.ts:11-17`(타입), `:94`,`:148`,`:169`(가드)
- Test: `lib/delivery-roster.test.ts` (신규)

- [ ] **Step 1: 실패 테스트 작성** — `lib/delivery-roster.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildRosterForDate, type RosterOrderFields, type RosterItemFields } from "./delivery-roster";

// 방문수령 주문(단품·정기 모두)은 발송 명단에서 빠져야 한다.
function once(id: string, method: string): RosterOrderFields {
  return { id, order_type: "단품", block_weeks: null, ship_date: "2026-06-12", ship_name: "홍길동", delivery_method: method };
}

describe("발송명단 방문수령 제외", () => {
  const items: RosterItemFields[] = [
    { order_id: "택배주문", product_name: "헤이밀크", volume: "750mL", delivery_day: "fri", qty: 2 },
    { order_id: "방문주문", product_name: "헤이밀크", volume: "750mL", delivery_day: "fri", qty: 2 },
  ];
  const orderById = new Map<string, RosterOrderFields>([
    ["택배주문", once("택배주문", "택배")],
    ["방문주문", once("방문주문", "방문수령")],
  ]);
  const confirmed = new Set(["택배주문", "방문주문"]);

  it("단품 방문수령은 명단에서 제외, 택배는 포함", () => {
    const roster = buildRosterForDate({
      dateISO: "2026-06-12",
      weekday: null,
      items,
      orderById,
      slotByOrder: new Map(),
      confirmedOrderIds: confirmed,
      pausedOrderIds: new Set(),
    });
    const ids = roster.map((e) => e.order.id);
    expect(ids).toContain("택배주문");
    expect(ids).not.toContain("방문주문");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/delivery-roster.test.ts`
Expected: FAIL — 타입에 `delivery_method` 없음(타입 에러) 또는 방문주문이 포함됨.

- [ ] **Step 3: 구현**
  - `lib/delivery-roster.ts` `RosterOrderFields`(line 11-17)에 필드 추가. **optional로 둔다** — admin `OrderRow`에 필드가 추가되기 전(Task 10)에도 제네릭 제약을 만족시켜 커밋 간 tsc가 깨지지 않게 한다(undefined는 방문수령이 아니므로 동작 안전):
    ```ts
    ship_name: string;
    delivery_method?: string; // '택배' | '방문수령' — 방문수령은 발송 대상 제외(미정의=택배 취급)
    ```
  - 정기 루프 가드(line 94) 수정:
    ```ts
    if (!order || order.order_type === "단품" || order.delivery_method === "방문수령") continue;
    ```
  - 첫배송 시프트 루프 가드(line 148) 수정:
    ```ts
    if (!order || order.order_type === "단품" || order.delivery_method === "방문수령") continue;
    ```
  - 단품 루프 가드(line 169) 수정:
    ```ts
    if (!order || order.order_type !== "단품" || order.delivery_method === "방문수령") continue;
    ```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/delivery-roster.test.ts`
Expected: PASS.

- [ ] **Step 5: 회귀 — tsc 확인**

Run: `npx tsc --noEmit`
Expected: 0 errors. (`delivery_method?`가 optional이라 admin `OrderRow`가 아직 필드를 안 가져도 제네릭 제약 만족 → 이 커밋도 green.)

- [ ] **Step 6: 커밋**

```bash
git add lib/delivery-roster.ts lib/delivery-roster.test.ts
git commit -m "feat: 발송 명단에서 방문수령 주문 제외"
```

---

## Chunk 2: 서버 RPC 마이그레이션 (수동 적용)

### Task 4: `supabase/migration-pickup-delivery.sql`

> **선행 확인:** 적용 전 prod에서 4개 함수 현재 정의 확인:
> ```sql
> select pg_get_functiondef('public._create_once_order_core(uuid,jsonb,jsonb,text)'::regprocedure);
> select pg_get_functiondef('public.create_once_order(jsonb,jsonb,text)'::regprocedure);
> select pg_get_functiondef('public.create_subscription_order(jsonb,int,jsonb,text)'::regprocedure);
> select pg_get_functiondef('public.request_renewal(bigint,jsonb,int,text)'::regprocedure);
> ```
> repo 정의(idempotency·renewal-modify)와 다르면 본 파일 본문을 prod 기준으로 동기화 후 적용.

**Files:**
- Create: `supabase/migration-pickup-delivery.sql`

- [ ] **Step 1: 스키마 변경 작성** (파일 상단, `begin;` 안)

```sql
begin;

-- 0) 컬럼: 수령방법(기본 택배). 기존 행은 default 로 백필.
alter table public.orders
  add column if not exists delivery_method text not null default '택배';
do $$ begin
  alter table public.orders
    add constraint orders_delivery_method_chk check (delivery_method in ('택배','방문수령'));
exception when duplicate_object then null; end $$;

-- 방문수령은 주소를 받지 않으므로 NOT NULL 제거(기존 행은 값이 있어 영향 없음).
alter table public.orders alter column ship_address drop not null;
```

- [ ] **Step 2: 4개 RPC를 `create or replace` 로 재정의 — prod 현재 본문(= repo 최신) 복사 + 아래 5개 diff만 적용**

각 함수에 동일 패턴으로 적용한다. **함수 시그니처는 불변**(값은 `p_ship->>'deliveryMethod'`로 전달).

**(A) 변수 선언부**에 추가:
```sql
v_method text := case when (p_ship->>'deliveryMethod') = '방문수령' then '방문수령' else '택배' end;
```
> 의도된 결정: 스펙 §5.5는 "잘못된 값이면 예외"라 했으나, 클라 `parseDeliveryMethod`와 일치하도록 **조용한 택배 폴백**을 쓴다(이상값은 배송비를 부과하는 안전한 방향). PR 설명에 이 의도를 명시.

**(B) 배송비 계산** 교체:
- 단품(`_create_once_order_core`, `create_once_order`):
  ```sql
  v_shipping := case
    when v_method = '방문수령' then 0
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
  ```
- 구독(`create_subscription_order`): `* v_weeks` 유지하되 방문수령이면 0:
  ```sql
  v_shipping := case
    when v_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000 else 4000 end) * v_weeks
  end;
  ```

**(C) 배송지 검증 완화** — 방문수령은 주소 필수에서 제외(이름·연락처는 유지):
```sql
if length(trim(coalesce(p_ship->>'name',''))) = 0
   or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10
   or (v_method = '택배' and length(trim(coalesce(p_ship->>'address',''))) = 0) then
  raise exception '받는 분·연락처를 올바르게 입력해 주세요.';
end if;
```

**(D) orders INSERT** — 각 함수의 INSERT 컬럼 목록(서로 다름)에 `delivery_method` 컬럼과 `v_method` 값을 추가(`..., delivery_method)` / `..., v_method)`).
⚠ **세 함수 모두** 현재 `ship_address`를 `trim(p_ship->>'address')`(NULL 미보정)로 넣는다 — `migration-order-idempotency.sql:167`(`_create_once_order_core`), `:306`(`create_once_order`), `:511`(`create_subscription_order`). 방문수령이면 주소가 없어 빈문자열로 저장되므로, **세 INSERT 모두** 다음으로 교체(빈값→null):
```sql
-- ship_address: 방문수령 빈값을 null 로 정규화
nullif(trim(coalesce(p_ship->>'address','')),'')
```

**(E) 멱등 재진입·슬롯·적립금·현금영수증·ship_date 로직은 그대로 보존.**

> 게스트 래퍼(`create_guest_once_order`)는 core 위임이라 본문 변경 없음(시그니처 동일).

- [ ] **Step 3: 갱신 RPC `request_renewal` 재정의 — 수령방법 승계**

repo 기준 `migration-renewal-modify.sql` 본문 복사 + diff:
- 원주문 행은 이미 `select * into v_src from public.orders where id = v_slot.order_id;`로 로드됨 → `v_src.delivery_method` 사용 가능.
- 배송비(원 `v_shipping := (case ... ) * v_weeks;`) 교체:
  ```sql
  v_shipping := case
    when v_src.delivery_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(v_src.ship_postcode) then 5000 else 4000 end) * v_weeks
  end;
  ```
- orders INSERT 컬럼/값에 `delivery_method` / `v_src.delivery_method` 추가.

- [ ] **Step 4: 검증 SQL을 파일 끝 주석으로** + `commit;`

```sql
commit;

-- 수기 검증(적용 후):
-- 1) 컬럼·제약: select column_name,is_nullable from information_schema.columns
--      where table_name='orders' and column_name in ('delivery_method','ship_address');
--    → delivery_method=NO(not null), ship_address=YES(nullable)
-- 2) 방문수령 단품(주소 없이) 생성 → shipping_fee=0, delivery_method='방문수령':
--    select public.create_guest_once_order('[{"product_id":"<PID>","qty":2}]'::jsonb,
--      '{"name":"홍길동","phone":"01012345678","deliveryMethod":"방문수령"}'::jsonb, 'pk-test-1');
--    select shipping_fee, delivery_method, ship_address from public.orders where order_no = '...';
-- 3) 택배 단품은 기존과 동일(shipping_fee=4000/5000).
```

- [ ] **Step 5: 커밋**

```bash
git add supabase/migration-pickup-delivery.sql
git commit -m "feat(db): 주문 RPC 방문수령 배송비 0 + 수령방법 컬럼/검증완화/갱신 승계"
```

> ⚠ **이 SQL은 머지 후 Supabase SQL Editor에 수동 적용한다.** 코드만 배포되고 SQL 미적용 시 방문수령인데 배송비가 붙는 불일치 발생(스펙 §8.2).

---

## Chunk 3: 클라이언트 결제 통합

### Task 5: `lib/orders.ts` — `ShippingInfo.deliveryMethod` 전달

**Files:**
- Modify: `lib/orders.ts:6-22`(타입), `:113-126`(shipPayload)

- [ ] **Step 1: 타입 추가** — `ShippingInfo` 에:
```ts
// 수령방법: 택배(기본) | 방문수령. 방문수령이면 서버가 배송비 0 + 주소 미요구.
deliveryMethod?: import("./delivery-method").DeliveryMethod;
```
- [ ] **Step 2: shipPayload** 반환 객체에 추가:
```ts
deliveryMethod: ship.deliveryMethod ?? "택배",
```
- [ ] **Step 3: 타입 확인** — `npx tsc --noEmit` → 0 errors.
- [ ] **Step 4: 커밋**
```bash
git add lib/orders.ts
git commit -m "feat: 주문 RPC 페이로드에 deliveryMethod 전달"
```

### Task 6: `components/DeliveryMethodSelect.tsx` — 공용 라디오 + 방문 안내

**Files:**
- Create: `components/DeliveryMethodSelect.tsx`

- [ ] **Step 1: 컴포넌트 작성** (기존 `PayMethodSelect.tsx` 스타일을 참고해 일치시킬 것)

```tsx
"use client";

import { BUSINESS, FARM_HOURS } from "@/lib/site";
import type { DeliveryMethod } from "@/lib/delivery-method";

// 택배/방문수령 선택 + 방문수령 안내. 단품·구독 결제 공용.
export function DeliveryMethodSelect({
  value,
  onChange,
}: {
  value: DeliveryMethod;
  onChange: (m: DeliveryMethod) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["택배", "방문수령"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            aria-pressed={value === m}
            className={
              "rounded-xl border px-4 py-3 text-sm transition " +
              (value === m
                ? "border-ink bg-ink text-paper"
                : "border-line bg-paper text-ink-soft hover:border-ink/40")
            }
          >
            {m === "택배" ? "택배 배송" : "방문수령 (배송비 무료)"}
          </button>
        ))}
      </div>

      {value === "방문수령" && (
        <div className="rounded-xl border border-line bg-paper-2/40 p-4 text-[13.5px] leading-relaxed text-ink-soft">
          <p className="font-medium text-ink">🏠 방문수령 안내 — 송영신목장 판매장</p>
          <dl className="mt-2 space-y-1">
            <div className="flex gap-2"><dt className="w-12 shrink-0 text-mute">주소</dt><dd>{BUSINESS.address}</dd></div>
            <div className="flex gap-2"><dt className="w-12 shrink-0 text-mute">운영</dt><dd>{FARM_HOURS}</dd></div>
            <div className="flex gap-2"><dt className="w-12 shrink-0 text-mute">문의</dt><dd>{BUSINESS.tel} · {BUSINESS.mobile}</dd></div>
          </dl>
          <p className="mt-2 text-mute">입금이 확인되면 안내된 수령 가능일부터 목장에서 받으실 수 있습니다.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입 확인** — `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3: 커밋**
```bash
git add components/DeliveryMethodSelect.tsx
git commit -m "feat: 수령방법 선택 공용 컴포넌트(방문 안내 포함)"
```

### Task 7: 구독 결제 `app/checkout/page.tsx` 통합

**Files:**
- Modify: `app/checkout/page.tsx`

- [ ] **Step 1: import 추가**
```ts
import { DeliveryMethodSelect } from "@/components/DeliveryMethodSelect";
import { DEFAULT_DELIVERY_METHOD, isPickup, subShippingFor, type DeliveryMethod } from "@/lib/delivery-method";
```

- [ ] **Step 2: state 추가** (다른 useState 근처):
```ts
const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(DEFAULT_DELIVERY_METHOD);
```

- [ ] **Step 3: 배송비 계산 교체** (line 73-75):
```ts
const isSpecialRegion = isSpecialDeliveryPostcode(ship.postcode);
const pickup = isPickup(deliveryMethod);
const shipTotal = subShippingFor(deliveryMethod, perDelivery, ship.postcode, weeks);
const periodTotal = perDelivery * weeks + shipTotal;
```

- [ ] **Step 4: 수령방법 전환 핸들러** — 방문수령 시 선물·주소 정리:
```ts
function changeDeliveryMethod(m: DeliveryMethod) {
  setDeliveryMethod(m);
  if (m === "방문수령") {
    setIsGift(false); // 선물은 택배 발송 전제 — 방문수령에선 숨김+초기화
    setShip((prev) => ({ ...prev, postcode: "", address: "", addressDetail: "" }));
    setAcceptFresh(false);
  }
}
```

- [ ] **Step 5: UI 렌더** — 주소/선물 블록 위에 `DeliveryMethodSelect` 추가, 방문수령일 때 주소·선물·특수지역 동의 블록을 숨김:
  - `<DeliveryMethodSelect value={deliveryMethod} onChange={changeDeliveryMethod} />`
  - 주소 입력(AddressSearch)·`GiftOptions`·특수지역 동의 UI는 `{!pickup && ( ... )}` 로 감싼다.
  - 배송비 표시 라인은 `pickup ? "방문수령 — 배송비 무료" : formatKRW(shipTotal)`.

- [ ] **Step 6: 제출 가드 수정** (line 175-182): 방문수령이면 주소·특수지역 검증 생략:
```ts
if (!ship.name.trim() || !ship.phone.trim() || (!pickup && !ship.address.trim())) {
  setError(pickup ? "받는 분, 연락처를 입력해 주세요." : "받는 분, 연락처, 주소를 입력해 주세요.");
  return;
}
if (!pickup && isSpecialRegion && !acceptFresh) { /* 기존 그대로 */ }
```

- [ ] **Step 7: createOrder 페이로드에 deliveryMethod** (line 201-208):
```ts
const { ... } = await createOrder(items, period, {
  ...ship,
  deliveryMethod,
  isGift,
  ...
}, idempotencyKey);
```

- [ ] **Step 8: 프로필 백필 가드** (line 223): 방문수령은 주소가 비어 프로필 덮어쓰기 방지:
```ts
if (profile && !isGift && !pickup) void backfillProfileShipping(profile, ship);
```

- [ ] **Step 9: 타입·빌드 확인**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 10: 커밋**
```bash
git add app/checkout/page.tsx
git commit -m "feat: 구독 결제 방문수령 선택(배송비 0·주소/선물 숨김)"
```

### Task 8: 단품 결제 `app/order-once/page.tsx` 통합

**Files:**
- Modify: `app/order-once/page.tsx` (계산 ~145-162, 제출 ~221-345, 백필 ~284)

- [ ] **Step 1: import + state** — Task 7과 동일 패턴:
```ts
import { DeliveryMethodSelect } from "@/components/DeliveryMethodSelect";
import { DEFAULT_DELIVERY_METHOD, isPickup, onceShippingFor, type DeliveryMethod } from "@/lib/delivery-method";
// ...
const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(DEFAULT_DELIVERY_METHOD);
const pickup = isPickup(deliveryMethod);
```

- [ ] **Step 2: 배송비 계산 교체** (현 `const shipping = onceShippingFee(subtotal, ship.postcode);`):
```ts
const shipping = onceShippingFor(deliveryMethod, subtotal, ship.postcode);
const total = subtotal + shipping;
```

- [ ] **Step 3: 전환 핸들러** — 방문수령 시 선물(있으면)·주소 초기화(checkout과 동일 구조). 단품 페이지의 gift/주소 state 이름에 맞춰 적용.

- [ ] **Step 4: UI** — `DeliveryMethodSelect` 추가, 주소·선물·특수지역 동의 블록을 `{!pickup && (...)}` 로 감쌈. 배송비 라인 분기. 안내문 "배송비 ₩4,000"(현 line ~365) 도 `pickup` 분기.

- [ ] **Step 5: 제출 가드 + 페이로드** — 방문수령이면 주소 검증 생략. `deliveryMethod`는 회원/게스트가 공유하는 단일 `shipInfo` 객체(`app/order-once/page.tsx:257-264`)에 한 번만 추가하면 `createOnceOrder`·`createGuestOnceOrder`(`:267-269`) 양쪽에 전파된다(2곳 수정 아님).

- [ ] **Step 6: 백필 가드** (line ~284): `!pickup` 조건 추가.

- [ ] **Step 7: 타입·빌드** — `npx tsc --noEmit` → 0 errors.

- [ ] **Step 8: 커밋**
```bash
git add app/order-once/page.tsx
git commit -m "feat: 단품 결제 방문수령 선택(배송비 0·주소/선물 숨김)"
```

### Task 9: 갱신 견적 — `delivery_method` 배선 + 배송비 0

> `RenewalForm`은 `sub: MySubscription`을 받는다(`lib/subscriptions.ts`). `MySubscription`엔 `delivery_method`가 없으므로 **조회 체인 4곳을 먼저 확장**해야 한다.

**Files:**
- Modify: `lib/subscriptions.ts` (select `:183`, `SlotJoinRow.orders` `:102-107`, `MySubscription` `:74-90`, `toMySubscriptions` `:151-168`)
- Modify: `app/account/RenewalForm.tsx` (`renewalQuote` 호출 `:131`)

- [ ] **Step 1: 조회 select 확장** — `lib/subscriptions.ts:183`의 `orders(...)` 조인 select 문자열에 `delivery_method` 추가.
- [ ] **Step 2: 타입 확장**
  - `SlotJoinRow.orders`(`:102-107`)에 `delivery_method: string | null;`
  - `MySubscription`(`:74-90`)에 `deliveryMethod: string;`
- [ ] **Step 3: 매핑** — `toMySubscriptions`(`:151-168`)에서 `deliveryMethod: row.orders?.delivery_method ?? "택배",`
- [ ] **Step 4: 견적 배송비 0** — `RenewalForm.tsx:131` `renewalQuote(quoteItems, period, shippingPerWeek)` 호출에서 방문수령이면 회당 배송비 0 전달(견적 `quote.shipping`/`quote.total`이 함께 0이 되어 표시·합계 일관):
```ts
renewalQuote(quoteItems, period, sub.deliveryMethod === "방문수령" ? 0 : SUB_SHIPPING_KRW)
```
(`SUB_SHIPPING_KRW`는 `@/lib/products`에서 import. 실제 청구는 서버 `request_renewal`가 권위 — 특수지역 5,000은 서버가 처리, 표시는 4,000 기준 기존 동작 유지.)
- [ ] **Step 5: 타입·빌드** — `npx tsc --noEmit` → 0 errors.
- [ ] **Step 6: 커밋**
```bash
git add lib/subscriptions.ts app/account/RenewalForm.tsx
git commit -m "feat: 갱신 견적 방문수령 배송비 0 + delivery_method 배선"
```

---

## Chunk 4: 관리자 + 알림

### Task 10: 관리자 `app/admin/page.tsx` — 타입 + 뱃지

**Files:**
- Modify: `app/admin/page.tsx` (`OrderRow` 타입 + 목록/360 렌더)

- [ ] **Step 1: `OrderRow` 타입에 추가**:
```ts
delivery_method: string; // '택배' | '방문수령'
```
(목록 fetch는 `.select("*")`라 데이터는 자동 유입 — 타입만 추가.)

- [ ] **Step 2: 뱃지 렌더** — 주문/구독 목록 행과 360 드로어에 `order.delivery_method === '방문수령'`이면 `방문수령` 뱃지 표시(기존 뱃지 스타일 재사용).

- [ ] **Step 3: 빌드 확인** — `npx tsc --noEmit` → 0 errors (Task 3의 로스터 타입 에러도 여기서 해소).

- [ ] **Step 4: 커밋**
```bash
git add app/admin/page.tsx
git commit -m "feat(admin): 방문수령 주문 뱃지 표시"
```

### Task 11: 입금확인 SMS `app/api/notify/route.ts` 방문수령 분기

> 주문 조회 alias는 `o`, 발송 문구 변수는 `dispatchLine`(월/일은 `mo`/`da`). **두 곳**에서 "발송해 드립니다"를 만든다: `order_received`(`:182-185`)와 `payment_confirmed`(`:212-216`). 둘 다 분기해야 방문수령에 "발송" 문구가 안 나간다.

**Files:**
- Modify: `app/api/notify/route.ts` (select `:140-144`, `dispatchLine` `:182-185` + `:212-216`)

- [ ] **Step 1: select 확장** — 주문 조회(`o`)에 `delivery_method` 추가.
- [ ] **Step 2: `order_received` 문구 분기** (`:182-185`) — `dispatchLine` 생성을 방문수령 분기:
```ts
const dispatchLine = o.delivery_method === "방문수령"
  ? `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일부터 목장에서 수령하실 수 있습니다.`
  : `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.`;
```
- [ ] **Step 3: `payment_confirmed` 문구 분기** (`:212-216`) — 같은 패턴으로 그쪽 `dispatchLine`도 방문수령 분기(실제 변수·문구는 현 코드에 맞춰 "발송"→"수령" 치환).
- [ ] **Step 4: 빌드 확인** — `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5: 커밋**
```bash
git add app/api/notify/route.ts
git commit -m "feat: 입금/결제 확인 SMS 방문수령 수령 안내 분기"
```

---

## Chunk 5: 검증 & PR

### Task 12: 전체 검증

- [ ] **Step 1: 단위 테스트 전체**

Run: `npx vitest run`
Expected: 전부 PASS (신규 `delivery-method`, `delivery-roster` 포함).

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 0 errors. (실패 시 `find .next -name "* 2.*" -delete` 후 재시도 — iCloud 복제본 이슈, 메모리 참조.)

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 성공(exit 0).

- [ ] **Step 4: 수동 시나리오 점검(개발 서버)** — `npm run dev` 후:
  - 단품 방문수령: 주소칸 사라짐, 배송비 0, 총액=상품합계, 안내박스 노출. 택배로 전환 시 복구.
  - 구독 방문수령: 동일 + 요일 슬롯 유지.
  - 선물 옵션: 방문수령에서 숨김.

- [ ] **Step 5: PR 생성** (commit-push-pr 규칙 따름)

```bash
git push -u origin feat/pickup-delivery-option
gh pr create --base main --title "feat: 방문수령/택배 선택(배송비 0)" --body "<요약 + 테스트 결과 + ⚠ 머지 후 migration-pickup-delivery.sql prod 수동 적용 필요>"
```

### Task 13: 배포 후 prod SQL 적용 (사람/관리자)

- [ ] PR 머지 후 Supabase SQL Editor에서 **prod 함수 드리프트 확인** → `migration-pickup-delivery.sql` 적용 → 파일 끝 검증 SQL 실행.
- [ ] 라이브에서 방문수령 단품 1건 실주문/취소로 `shipping_fee=0`·발송명단 제외 확인.

---

## 검증 체크리스트 (스펙 §7 대응)

- [ ] 단품 택배 = subtotal + 4,000/5,000 (회귀)
- [ ] 단품 방문수령 = subtotal, 주소 없이 생성, 이름·전화 누락 시 예외
- [ ] 구독 택배 = 상품×주수 + 주당택배비×주수 (회귀)
- [ ] 구독 방문수령 = 상품×주수, 슬롯 정상, 배송비 0
- [ ] 갱신: 방문수령 구독 연장 시 배송비 0 + delivery_method 승계
- [ ] 발송명단/송장에서 방문수령 제외
- [ ] 입금확인 SMS 방문수령 문구 분기
- [ ] 기존 주문(default '택배') 영향 없음
- [ ] 멱등 재호출 동일 주문 반환
