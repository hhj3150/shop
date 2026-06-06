# 실시간 재고 원장(자동차감) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고/출고/조정/폐기를 거래(원장)로 기록하고, 배송 출고 시 재고를 1회만 자동 차감하며, 안전재고 미만을 경보하는 재고 원장 모듈을 만든다.

**Architecture:** 권위값 `product_catalog.stock`은 유지하고, 그 변동을 불변 원장 `stock_movements`에 기록한다. 모든 쓰기는 `security definer` RPC(`stock_adjust`, `stock_ship_out`)로만 일어나고 `is_admin()` 게이트 + `for update` 행잠금으로 원자성을 보장한다. 배송 출고는 `shipment_log(order_id, ship_date)` unique 제약으로 주차별 1회 차감을 강제한다. 순수 로직(부족 판정·차감 계산)은 `lib/inventory.ts`에 분리해 vitest로 TDD하고, RPC 래퍼는 `lib/inventory-data.ts`, UI는 신규 `InventoryPanel` + `DispatchPanel` 행별 [출고 확정] 버튼.

**Tech Stack:** Next.js 16 (App Router, React 19) · Supabase(Postgres, RLS, plpgsql RPC) · TypeScript · vitest · Tailwind v4.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|----------|
| `lib/inventory.ts` | 순수 로직: 부족 판정·차감 계산·movement kind 상수. supabase import 없음. | 신규 |
| `lib/inventory.test.ts` | `lib/inventory.ts` 단위 테스트(vitest, node). | 신규 |
| `lib/inventory-data.ts` | RPC/조회 래퍼: `stockAdjust`·`stockShipOut`·`loadInventory`·`loadMovements`·`loadShippedKeys`. | 신규 |
| `components/InventoryPanel.tsx` | 상품·재고 탭 UI: 현재고·안전재고·부족 배지 + 입고/조정/폐기 버튼 + 원장 이력. | 신규 |
| `supabase/migration-inventory-ledger.sql` | DDL(safety_stock·stock_movements·shipment_log·RLS) + RPC 2종 + 하단 검증 SQL. 수동 적용. | 신규 |
| `components/DispatchPanel.tsx` | 각 배송 행에 [출고 확정] 추가, 이미 출고된 행 비활성. | 수정(외과적) |
| `app/admin/page.tsx` | 상품·재고 탭에 `InventoryPanel` 추가, DispatchPanel에 `shippedKeys` 전달. | 수정(외과적) |

**보존(절대 변경 금지):** `_create_once_order_core` / `create_subscription_order`의 stock=0 품절 차단 로직, 스토어프론트 카탈로그 로직. 이 두 주문 RPC의 **라이브 최신 본문은 `migration-special-delivery-region.sql`**(storefront-catalog-guard 를 이후 마이그레이션이 덮어씀)에 있다. 본 마이그레이션은 **신규 추가만** 하며 이 두 RPC를 `create or replace` 하지 않는다 → 가드 자동 보존.

---

## Chunk 1: 순수 로직 (TDD)

핵심 불변식을 TS 순수 함수로 먼저 못 박는다. SQL RPC가 이 불변식을 그대로 구현한다.

### Task 1: `isLowStock` — 안전재고 부족 판정

**Files:**
- Create: `lib/inventory.ts`
- Test: `lib/inventory.test.ts`

**판정 규칙(스펙 §UI):** 부족 = `stock`과 `safetyStock`이 모두 숫자이고 `stock <= safetyStock`. stock이 NULL(무제한)이거나 safetyStock이 NULL(경보 안 함)이면 **부족 아님**.

- [ ] **Step 1: 실패 테스트 작성** — `lib/inventory.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { isLowStock } from "./inventory";

describe("isLowStock", () => {
  it("현재고 ≤ 안전재고 → 부족", () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(0, 5)).toBe(true);
  });
  it("현재고 > 안전재고 → 정상", () => {
    expect(isLowStock(6, 5)).toBe(false);
  });
  it("안전재고 NULL(경보 안 함) → 항상 정상", () => {
    expect(isLowStock(0, null)).toBe(false);
  });
  it("현재고 NULL(무제한) → 항상 정상", () => {
    expect(isLowStock(null, 5)).toBe(false);
    expect(isLowStock(null, null)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: FAIL (`isLowStock`/모듈 미존재).

- [ ] **Step 3: 최소 구현** — `lib/inventory.ts`

```typescript
// 재고 원장 순수 로직 — 부족 판정·차감 계산. DB·supabase 의존 없음(테스트 가능).
//   권위값은 product_catalog.stock(현재고), 변동 이력은 stock_movements(원장).
//   여기서는 SQL RPC 가 강제하는 불변식(음수 차단·무제한 통과)을 TS 로도 동일하게 둔다.

// 안전재고 부족 판정. 현재고·안전재고가 모두 숫자이고 현재고 ≤ 안전재고면 부족.
//   현재고 NULL(무제한) 또는 안전재고 NULL(경보 안 함)이면 부족 아님.
export function isLowStock(
  stock: number | null,
  safetyStock: number | null
): boolean {
  if (stock === null || safetyStock === null) return false;
  return stock <= safetyStock;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/inventory.ts lib/inventory.test.ts
git commit -m "feat(inventory): 안전재고 부족 판정 isLowStock (TDD)"
```

### Task 2: `nextStock` — 차감/증감 계산 + 음수 차단 + 무제한 통과

**Files:**
- Modify: `lib/inventory.ts`
- Test: `lib/inventory.test.ts`

**규칙(스펙 §RPC):** `nextStock(current, delta)`는 변동 후 현재고를 돌려준다.
- `current === null`(무제한): 변동 무시, `null` 반환(차감 스킵 대상).
- 결과가 0 미만이면 `RangeError('재고 부족')` throw(**0 미만 차단** 정책).
- 그 외에는 `current + delta` 반환(delta는 +입고/조정, −출고/폐기).

- [ ] **Step 1: 실패 테스트 추가** — `lib/inventory.test.ts` 하단에 추가

```typescript
import { isLowStock, nextStock } from "./inventory";

describe("nextStock", () => {
  it("입고(+)·출고(−) 정상 가감", () => {
    expect(nextStock(10, 5)).toBe(15);
    expect(nextStock(10, -4)).toBe(6);
    expect(nextStock(10, -10)).toBe(0); // 0 까지는 허용
  });
  it("0 미만이 되면 차단(throw)", () => {
    expect(() => nextStock(3, -4)).toThrow(/재고 부족/);
  });
  it("현재고 NULL(무제한) → 변동 무시하고 null 반환", () => {
    expect(nextStock(null, -100)).toBe(null);
    expect(nextStock(null, 50)).toBe(null);
  });
});
```

> 주의: 1번 테스트의 import 한 줄을 `import { isLowStock, nextStock } from "./inventory";` 로 합친다(중복 import 금지).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: FAIL (`nextStock` 미존재).

- [ ] **Step 3: 최소 구현** — `lib/inventory.ts` 에 추가

```typescript
// 변동 후 현재고. current=null(무제한)이면 변동을 무시하고 null(차감 스킵)을 반환.
//   결과가 0 미만이면 차단(스펙: 0 미만 금지). delta 는 +입고/조정, −출고/폐기.
export function nextStock(current: number | null, delta: number): number | null {
  if (current === null) return null;
  const result = current + delta;
  if (result < 0) {
    throw new RangeError("재고 부족: 차감 후 수량이 0 미만이 됩니다.");
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: PASS (전체 green).

- [ ] **Step 5: movement kind 상수 추가 + 테스트**

`lib/inventory.test.ts`:

```typescript
import { isLowStock, nextStock, MOVEMENT_KINDS, type MovementKind } from "./inventory";

describe("MOVEMENT_KINDS", () => {
  it("4종 거래 유형(입고·출고·조정·폐기)", () => {
    expect(MOVEMENT_KINDS).toEqual(["입고", "출고", "조정", "폐기"]);
  });
});
```

`lib/inventory.ts`:

```typescript
// 원장 거래 유형. SQL check 제약(stock_movements.kind)과 1:1 일치해야 한다.
export const MOVEMENT_KINDS = ["입고", "출고", "조정", "폐기"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
```

- [ ] **Step 6: 통과 확인 + tsc** — Run: `npx vitest run lib/inventory.test.ts && npx tsc --noEmit` · Expected: 테스트 PASS, tsc 0 errors.

- [ ] **Step 7: 커밋**

```bash
git add lib/inventory.ts lib/inventory.test.ts
git commit -m "feat(inventory): 차감 계산 nextStock(음수 차단·무제한 통과) + kind 상수 (TDD)"
```

---

## Chunk 2: DB 마이그레이션 (DDL + RPC + 검증 SQL)

> 마이그레이션은 **수동 적용**이며 **커밋 전 사용자 승인** 필요. PUBLIC repo → 시크릿 금지. 파일 하단의 검증 SQL은 SQL 레드-그린(이중출고 1회·음수차단·동시성) 근거다.

### Task 3: 마이그레이션 파일 작성

**Files:**
- Create: `supabase/migration-inventory-ledger.sql`

- [ ] **Step 1: DDL — safety_stock 컬럼 + 두 테이블 + RLS**

```sql
-- ─────────────────────────────────────────────────────────────
-- 물류 ERP ① 실시간 재고 원장(자동차감)
--   product_catalog.stock(현재고 권위값)은 유지하고, 그 변동을 불변 원장에 기록한다.
--   쓰기는 security definer RPC 로만(is_admin 게이트 + for update 원자성).
--   배송 출고는 shipment_log unique 로 주차(발송일)별 1회만 차감.
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 안전재고(경보 기준). NULL = 경보 안 함. stock 은 현재고 권위값으로 유지.
alter table public.product_catalog
  add column if not exists safety_stock integer
    check (safety_stock is null or safety_stock >= 0);

-- 2) 불변 원장: 입고/출고/조정/폐기 거래.
create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   text not null references public.product_catalog (id),
  delta        integer not null,                 -- +입고/조정, −출고/폐기
  kind         text not null check (kind in ('입고','출고','조정','폐기')),
  ref_order_id uuid references public.orders (id),  -- 출고 시 연결 주문(감사)
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid                                -- auth.uid()
);
create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

alter table public.stock_movements enable row level security;
-- 조회는 관리자만. 쓰기 정책은 두지 않는다(RPC=security definer 만 INSERT).
drop policy if exists "stock_movements_select_admin" on public.stock_movements;
create policy "stock_movements_select_admin" on public.stock_movements
  for select using (public.is_admin());

-- 3) 이중차감 방지 로그. 같은 주문·같은 발송일은 1회만 차감.
create table if not exists public.shipment_log (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id),
  ship_date   date not null,
  deducted_at timestamptz not null default now(),
  unique (order_id, ship_date)
);
alter table public.shipment_log enable row level security;
drop policy if exists "shipment_log_select_admin" on public.shipment_log;
create policy "shipment_log_select_admin" on public.shipment_log
  for select using (public.is_admin());
```

- [ ] **Step 2: RPC `stock_adjust`(입고/조정/폐기)** — 파일에 이어서 작성

```sql
-- 4) 관리자 수동 거래(입고/조정/폐기). movement insert + stock 원자 증감(for update).
--    음수 재고 차단(0 미만이면 예외). 무제한(stock IS NULL) 품목은 조정 불가(예외).
create or replace function public.stock_adjust(
  p_product_id text,
  p_delta      integer,
  p_kind       text,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
  v_new   int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_kind not in ('입고','조정','폐기') then
    raise exception '거래 유형이 올바르지 않습니다: %', p_kind;
  end if;
  if p_delta = 0 then raise exception '변동 수량이 0 입니다.'; end if;

  -- 현재고 행잠금(동시 차감 직렬화).
  select stock into v_stock from public.product_catalog
    where id = p_product_id for update;
  if not found then raise exception '존재하지 않는 제품입니다: %', p_product_id; end if;
  if v_stock is null then
    raise exception '무제한(재고 미관리) 품목은 조정할 수 없습니다. 먼저 현재고를 설정하세요.';
  end if;

  v_new := v_stock + p_delta;
  if v_new < 0 then
    raise exception '재고 부족: 현재고 % 에서 % 를 적용할 수 없습니다.', v_stock, p_delta;
  end if;

  update public.product_catalog set stock = v_new where id = p_product_id;
  insert into public.stock_movements (product_id, delta, kind, note, created_by)
    values (p_product_id, p_delta, p_kind, nullif(trim(coalesce(p_note,'')),''), auth.uid());

  return jsonb_build_object('product_id', p_product_id, 'stock', v_new);
end;
$$;

grant execute on function public.stock_adjust(text, integer, text, text) to authenticated;
```

- [ ] **Step 3: RPC `stock_ship_out`(배송 출고 자동차감)** — 파일에 이어서 작성

```sql
-- 5) 배송 출고 확정 시 자동 차감. shipment_log unique 로 주차(발송일)별 1회만.
--    이미 출고된 주문·발송일이면 '이미 출고됨' 반환(차감 안 함, 이중차감 방지).
--    그 발송일에 해당하는 품목만 합산 → '출고' movement + stock 차감. stock NULL 품목은 건너뜀.
--
--    [불변식 — 과차감 방지의 핵심]
--    · order_items.qty 는 '회당(1발송) 수량'이다(create_subscription_order 가 v_qty 를 그대로 저장,
--      ×주차 아님). 따라서 발송일마다 1회 차감하면 정확히 그 주차 1회분만 빠진다.
--    · 구독이 여러 요일에 품목을 둘 수 있으므로, p_ship_date 의 요일과 일치하는 품목만 차감한다
--      (월요일 출고 → 월요일 품목만). 단품은 delivery_day=null → 그 발송일에 1회 전량 차감.
--    · 같은 (주문, 발송일) 재호출은 shipment_log unique 충돌로 1회만 → 주차별 정확히 1회.
create or replace function public.stock_ship_out(
  p_order_id  uuid,
  p_ship_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_dow      int := extract(dow from p_ship_date)::int;  -- 0=일 … 6=토
  v_day      text;
  v_rec      record;
  v_stock    int;
  v_new      int;
  v_deducted int := 0;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_order_id is null or p_ship_date is null then
    raise exception '주문·발송일이 필요합니다.';
  end if;

  -- 발송일의 요일키(구독 품목 필터용). 주말이면 null → 구독 품목은 매칭 안 됨(단품만).
  v_day := case v_dow
             when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
             when 4 then 'thu' when 5 then 'fri' else null end;

  -- 이중차감 방지: 같은 주문·발송일 1회만. 충돌이면 아무 행도 안 들어옴.
  insert into public.shipment_log (order_id, ship_date)
    values (p_order_id, p_ship_date)
    on conflict (order_id, ship_date) do nothing;
  get diagnostics v_inserted = row_count;  -- 0 = 충돌(이미 출고됨)
  if v_inserted = 0 then
    return jsonb_build_object('status', 'already', 'deducted', 0);
  end if;

  -- 그 발송일 해당 품목만 합산 후 차감(단품=delivery_day null, 구독=요일 일치).
  --   order by product_id: stock_adjust 와 동일한 잠금 순서 → 교착(deadlock) 방지.
  for v_rec in
    select product_id, sum(qty)::int as qty
      from public.order_items
     where order_id = p_order_id
       and (delivery_day is null or delivery_day = v_day)
     group by product_id
     order by product_id
  loop
    select stock into v_stock from public.product_catalog
      where id = v_rec.product_id for update;
    if not found then continue; end if;          -- 카탈로그에 없는 제품은 건너뜀
    if v_stock is null then continue; end if;     -- 무제한 품목은 차감 안 함

    v_new := v_stock - v_rec.qty;
    if v_new < 0 then
      raise exception '재고 부족: % 현재고 %, 출고 % 불가', v_rec.product_id, v_stock, v_rec.qty;
    end if;
    update public.product_catalog set stock = v_new where id = v_rec.product_id;
    insert into public.stock_movements (product_id, delta, kind, ref_order_id, note, created_by)
      values (v_rec.product_id, -v_rec.qty, '출고', p_order_id,
              to_char(p_ship_date, 'YYYY-MM-DD') || ' 배송 출고', auth.uid());
    v_deducted := v_deducted + 1;
  end loop;

  return jsonb_build_object('status', 'shipped', 'deducted', v_deducted);
end;
$$;

grant execute on function public.stock_ship_out(uuid, date) to authenticated;
```

- [ ] **Step 4: 하단 검증 SQL(레드-그린 근거, 주석)** — 파일 맨 아래에 주석으로 작성

```sql
-- ── 검증(수동, SQL Editor 에서 단계별 실행) ──────────────────────
-- 사전: 관리자 세션에서 실행(is_admin()=true). 테스트 제품 1개 준비.
--   update product_catalog set stock = 10, safety_stock = 3 where id = 'milk-180';
--
-- A. 음수재고 차단:
--   select stock_adjust('milk-180', -100, '폐기', '음수 테스트');
--   → 기대: ERROR '재고 부족 …'. (그린: 차단됨)
--
-- B. 정상 입고/조정:
--   select stock_adjust('milk-180', 50, '입고', '일배치 생산');
--   → 기대: {"stock": 60}. select stock from product_catalog where id='milk-180'; → 60.
--
-- C. 출고 1회 차감:
--   (milk-180 qty 2 짜리 주문 1건의 id 를 :oid 로.)
--   select stock_ship_out(:oid, current_date);
--   → 기대: {"status":"shipped","deducted":>=1}. stock 이 qty 만큼 감소.
--
-- D. 이중 출고 → 차감 1회만(레드-그린 핵심):
--   select stock_ship_out(:oid, current_date);  -- 같은 주문·같은 발송일 재호출
--   → 기대: {"status":"already","deducted":0}. stock 변화 없음.
--   select count(*) from stock_movements where ref_order_id = :oid;  -- 출고 movement 1세트만.
--
-- E. 동시성(for update) — 두 세션에서 동시에:
--   세션1: begin; select stock_adjust('milk-180', -30, '조정', 's1');  -- 커밋 보류
--   세션2: select stock_adjust('milk-180', -40, '조정', 's2');         -- 블록되어 대기
--   세션1: commit;  → 세션2 가 진행되며 갱신된 현재고 기준으로 음수면 차단.
--   → for update 가 없으면 둘 다 같은 현재고를 읽어 과차감. 있으면 직렬화됨.
--
-- F. 무제한 품목 스킵:
--   update product_catalog set stock = null where id = 'yogurt-500';
--   yogurt-500 포함 주문 출고 → 해당 품목 movement 없음·stock 그대로 null.
--
-- 정리(테스트 데이터 롤백):
--   delete from shipment_log where order_id = :oid;
--   delete from stock_movements where ref_order_id = :oid or note like '%테스트%';
```

- [ ] **Step 5: 사용자에게 적용 요청 + 레드-그린 검증 보고**

> 구현자는 이 SQL을 직접 DB에 적용할 수 없다(시크릿/권한). 사용자에게:
> 1. 파일 전체를 Supabase SQL Editor 에 실행 요청.
> 2. 검증 A~F 단계 실행 후 결과(특히 D=이중출고 1회, A=음수차단) 회신 요청.
> 회신으로 레드-그린이 확인되면 다음 청크로.

- [ ] **Step 6: 커밋(사용자 승인 후)**

```bash
git add supabase/migration-inventory-ledger.sql
git commit -m "feat(inventory): 재고 원장 마이그레이션(stock_movements·shipment_log·RPC)"
```

---

## Chunk 3: 데이터 접근 래퍼 (`lib/inventory-data.ts`)

UI가 호출할 얇은 RPC/조회 래퍼. `lib/catalog.ts`의 try/catch·console.error·재포장 패턴을 그대로 따른다.

### Task 4: 조회 + RPC 래퍼

**Files:**
- Create: `lib/inventory-data.ts`

- [ ] **Step 1: 타입 + 조회 함수 작성**

```typescript
// 재고 원장 데이터 접근 — 관리자 ERP 용. 쓰기는 전부 security definer RPC 경유.
//   조회: 재고 현황(product_catalog) · 원장 이력(stock_movements) · 출고 이력(shipment_log).
import { getSupabase } from "@/lib/supabase";
import type { MovementKind } from "@/lib/inventory";

// 재고 현황 1행(현재고·안전재고 포함). product_catalog 의 재고 관점 뷰.
export type InventoryRow = {
  id: string;
  name: string;
  volume: string;
  stock: number | null;
  safety_stock: number | null;
  active: boolean;
};

// 원장 이력 1건.
export type StockMovement = {
  id: string;
  product_id: string;
  delta: number;
  kind: MovementKind;
  ref_order_id: string | null;
  note: string | null;
  created_at: string;
};

// 재고 현황 전체(id 순).
export async function loadInventory(): Promise<InventoryRow[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("product_catalog")
      .select("id, name, volume, stock, safety_stock, active")
      .order("id");
    if (error) throw error;
    return (data as InventoryRow[]) ?? [];
  } catch (error) {
    console.error("재고 현황 조회 실패:", error);
    throw new Error("재고 현황을 불러오지 못했습니다.");
  }
}

// 최근 원장 이력(기본 50건).
export async function loadMovements(limit = 50): Promise<StockMovement[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("stock_movements")
      .select("id, product_id, delta, kind, ref_order_id, note, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as StockMovement[]) ?? [];
  } catch (error) {
    console.error("재고 원장 이력 조회 실패:", error);
    throw new Error("재고 이력을 불러오지 못했습니다.");
  }
}

// 이미 출고된 (order_id, ship_date) 키 집합 — DispatchPanel 버튼 비활성용.
//   키 형식: `${order_id}|${ship_date}`.
export async function loadShippedKeys(): Promise<Set<string>> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("shipment_log")
      .select("order_id, ship_date");
    if (error) throw error;
    return new Set(
      (data ?? []).map((r) => `${r.order_id}|${r.ship_date}`)
    );
  } catch (error) {
    console.error("출고 이력 조회 실패:", error);
    throw new Error("출고 이력을 불러오지 못했습니다.");
  }
}
```

- [ ] **Step 2: RPC 래퍼 작성** — 파일에 이어서

```typescript
// 관리자 수동 거래(입고/조정/폐기). 성공 시 변동 후 현재고 반환.
export async function stockAdjust(
  productId: string,
  delta: number,
  kind: MovementKind,
  note?: string
): Promise<number> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_adjust", {
      p_product_id: productId,
      p_delta: delta,
      p_kind: kind,
      p_note: note ?? null,
    });
    if (error) throw error;
    return (data as { stock: number }).stock;
  } catch (error) {
    console.error("재고 조정 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "재고 조정에 실패했습니다."
    );
  }
}

// 배송 출고 확정 → 자동 차감. 'shipped'(차감함) | 'already'(이미 출고) 반환.
export async function stockShipOut(
  orderId: string,
  shipDate: string
): Promise<"shipped" | "already"> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_ship_out", {
      p_order_id: orderId,
      p_ship_date: shipDate,
    });
    if (error) throw error;
    return (data as { status: "shipped" | "already" }).status;
  } catch (error) {
    console.error("출고 처리 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "출고 처리에 실패했습니다."
    );
  }
}
```

> 주의: supabase-js 의 RPC 에러는 `error.message`에 Postgres `raise exception` 메시지를 담는다. 위 재포장은 그 메시지를 사용자에게 그대로 노출한다(한국어 메시지 설계됨).

- [ ] **Step 3: tsc 검증** — Run: `npx tsc --noEmit` · Expected: 0 errors.

- [ ] **Step 4: 커밋**

```bash
git add lib/inventory-data.ts
git commit -m "feat(inventory): 재고 조회·RPC 래퍼(stockAdjust·stockShipOut·loadInventory)"
```

---

## Chunk 4: InventoryPanel UI (상품·재고 탭)

### Task 5: InventoryPanel 컴포넌트

**Files:**
- Create: `components/InventoryPanel.tsx`
- Modify: `app/admin/page.tsx` (상품·재고 탭에 추가)

설계: `ProductAdminPanel`의 로드/에러/저장 패턴을 따른다. 행마다 현재고·안전재고·부족 배지(`isLowStock`) + [입고]/[조정]/[폐기] 액션(수량·사유 입력) → `stockAdjust` 호출 → 성공 시 로컬 stock 갱신 + 이력 재조회. 하단에 원장 이력(최근 N건).

- [ ] **Step 1: 컴포넌트 작성** (`components/InventoryPanel.tsx`)

핵심 요소(전체 코드는 구현 시 ProductAdminPanel 스타일로 작성):
- `useEffect`로 `loadInventory()` + `loadMovements()` 동시 로드(`Promise.all`).
- 상태: `rows: InventoryRow[]`, `movements: StockMovement[]`, `loading`, `error`, `busyId`.
- 행별 입력: `qty`(수량), `kind`(입고/조정/폐기 셀렉트), `note`(사유). 액션 버튼 클릭 시:
  - 입고: `delta = +qty`. 폐기: `delta = -qty`. 조정: 부호 포함 입력 또는 +/− 토글(설계: 조정은 "증/감" 토글 + 수량).
  - `await stockAdjust(id, delta, kind, note)` → 반환 stock 으로 `setRows` 불변 갱신 → `loadMovements()` 재조회.
- 부족 배지: `isLowStock(r.stock, r.safety_stock)` → 🔴 빨간 배지. 무제한(stock=null)은 "무제한" 표기.
- **무제한→재고관리 전환:** `stock_adjust` 는 stock=null 품목을 막으므로(예외), NULL 품목에는 입출고 버튼 대신 "재고 관리 시작"(초기 현재고 입력) 액션을 둔다 → `saveCatalogProduct(id, { stock: n })`(catalog.ts, 관리자 RLS update) 호출 후 재조회. 이걸로 null→정수 전환 경로를 확보한다(스펙: "먼저 현재고를 설정").
- 안전재고 인라인 편집: `safety_stock`은 `product_catalog` 직접 update(관리자 RLS, `saveCatalogProduct` 와 동일 경로) — **단, catalog.ts 에 safety_stock 추가가 필요**. → Task 6 으로 분리.
- 원장 이력 표: 일시·제품·유형(색상 배지)·증감(±)·사유.
- 불변성: 모든 상태 업데이트는 spread 로 새 객체 생성(전역 규칙).

- [ ] **Step 2: 상품·재고 탭에 마운트** — `app/admin/page.tsx`

```tsx
import { InventoryPanel } from "@/components/InventoryPanel";
// ...
{tab === "상품·재고" && (
  <>
    <ProductAdminPanel />
    <InventoryPanel />
  </>
)}
```

- [ ] **Step 3: tsc + 프리뷰 검증** — Run: `npx tsc --noEmit`. 그리고 preview_start → 관리자 로그인 불가 시 컴포넌트 단위 렌더만 확인(스냅샷/콘솔 에러 0). 빌드 에러 없으면 다음.

- [ ] **Step 4: 커밋**

```bash
git add components/InventoryPanel.tsx app/admin/page.tsx
git commit -m "feat(inventory): 상품·재고 탭 InventoryPanel(현재고·부족 배지·입출고·원장 이력)"
```

### Task 6: 안전재고 편집 경로 (catalog.ts 확장)

**Files:**
- Modify: `lib/catalog.ts` (CatalogProduct·CatalogPatch·select·update 에 `safety_stock` 추가)
- Modify: `components/ProductAdminPanel.tsx` 또는 InventoryPanel 에서 안전재고 저장

- [ ] **Step 1: `CatalogProduct`·`CatalogPatch` 에 `safety_stock: number | null` 추가**, `loadCatalog` select 와 `saveCatalogProduct` clean 로직에 동일 정규화(`null` 또는 `Math.max(0, round)`) 추가. 기존 필드 로직은 **변경 금지(외과적)**.

- [ ] **Step 2: tsc 검증** — Run: `npx tsc --noEmit` · Expected: 0 errors(기존 사용처 호환).

- [ ] **Step 3: 커밋**

```bash
git add lib/catalog.ts components/InventoryPanel.tsx
git commit -m "feat(inventory): 안전재고(safety_stock) 편집 경로 추가"
```

---

## Chunk 5: DispatchPanel 출고 확정

### Task 7: 배송 행 [출고 확정] 버튼

**Files:**
- Modify: `components/DispatchPanel.tsx`
- Modify: `app/admin/page.tsx` (shippedKeys 로드 + prop 전달)

설계: 각 배송 행은 `(o.id, r.shipISO)` 단위. `shippedKeys: Set<string>`(`${id}|${shipISO}`)를 prop 으로 받아 이미 출고된 행은 버튼 비활성("출고됨"). 클릭 시 `stockShipOut(o.id, r.shipISO)`:
- `'shipped'` → 로컬 `shipped` Set 에 키 추가(즉시 비활성) + `onReload()`(재고 반영).
- `'already'` → 동일하게 비활성 처리(이중차감 불가 확인).

- [ ] **Step 1: 관리자 load 에 shipment_log 추가** — `app/admin/page.tsx` `load()` 의 `Promise.all` 에 `loadShippedKeys()` 추가, `shippedKeys` 상태 보관, `<DispatchPanel ... shippedKeys={shippedKeys} />` 전달.

- [ ] **Step 2: DispatchPanel prop + 버튼 추가**
  - props 에 `shippedKeys?: Set<string>` 추가(기본 빈 Set), 로컬 `const [justShipped, setJustShipped] = useState<Set<string>>(new Set())`.
  - 행 키 헬퍼 `shipKey(o, r) = \`${o.id}|${r.shipISO}\``.
  - 표에 "출고" 컬럼 1개 추가(헤더·td·colSpan 보정). 버튼:
    - 이미 출고(`shippedKeys.has(key) || justShipped.has(key)`)면 비활성 "출고됨".
    - 아니면 [출고 확정] → `await stockShipOut(o.id, r.shipISO)` → 성공/already 모두 `setJustShipped(prev => new Set(prev).add(key))` + `await onReload()`.
  - 기존 `bulkShip`/`bulkStatus`/CSV/정렬 로직은 **변경 금지**. 빈 상태 `colSpan={12}` → 새 컬럼 수로 보정.

- [ ] **Step 3: tsc + 프리뷰 검증** — Run: `npx tsc --noEmit`. preview 로 배송 탭 렌더·콘솔 에러 0 확인. (출고 동작 자체는 관리자+DB 필요 → 사용자 확인 단계로.)

- [ ] **Step 4: 커밋**

```bash
git add components/DispatchPanel.tsx app/admin/page.tsx
git commit -m "feat(dispatch): 배송 행 [출고 확정] → 재고 자동차감(이중차감 행 비활성)"
```

---

## Chunk 6: 통합 검증 + 마무리

### Task 8: 전체 검증

- [ ] **Step 1: 전체 테스트** — Run: `npm test` · Expected: 기존 + inventory 신규 전부 PASS, 0 fail.
- [ ] **Step 2: 타입 체크** — Run: `npx tsc --noEmit` · Expected: 0 errors.
- [ ] **Step 3: 린트** — Run: `npm run lint` · Expected: 0 errors(console.error 는 기존 패턴이라 허용 범위 확인).
- [ ] **Step 4: 빌드** — Run: `npm run build` · Expected: exit 0.
- [ ] **Step 5: 요구사항 체크리스트 대조**(스펙 §검증):
  - [ ] safety_stock 추가·stock 권위값 유지
  - [ ] stock_movements(+RLS) / shipment_log(+unique)
  - [ ] stock_adjust(음수 차단·무제한 예외) / stock_ship_out(unique 1회·무제한 스킵)
  - [ ] InventoryPanel(부족 배지·입출고·이력) / DispatchPanel [출고 확정]
  - [ ] 차감 시점 = 배송 출고(주차 1회)
  - [ ] 순수 로직 TDD green / SQL 레드-그린(이중출고·음수·동시성) 확인
  - [ ] 기존 품절 차단·스토어프론트 100% 보존(외과적)
- [ ] **Step 6: 코드 리뷰** — superpowers:requesting-code-review (또는 code-reviewer/security-reviewer 서브에이전트). CRITICAL/HIGH 해결.
- [ ] **Step 7: 사용자 승인 → main push → Netlify 자동 배포.**

---

## Remember
- DRY / YAGNI / TDD / 잦은 커밋 / 외과적 변경(요청 라인만).
- 불변성: 모든 상태·객체 갱신은 spread 로 새 객체.
- 마이그레이션 수동 적용 + 커밋 전 사용자 승인. PUBLIC repo 시크릿 금지.
- 기존 stock=0 품절 차단·스토어프론트 로직은 절대 건드리지 않는다.
