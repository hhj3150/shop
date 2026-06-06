# 유통기한 임박 경보(모듈 ②) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고 시 유통기한을 기록하고, 제품별 가장 임박한 유통기한을 D-3 경보로 띄워 폐기를 줄인다(모듈 ① 재고 원장 위에 얹음).

**Architecture:** `stock_movements`에 `expiry_date` 1컬럼을 더하고, `stock_adjust` RPC에 선택 5번째 인자 `p_expiry`를 추가(입고 행에만 저장)한다. 순수 함수 `daysUntil`(KST)·`expiryAlert`(D-3)로 경보 상태를 계산해 `InventoryPanel`에 배지·칩으로 표시한다. FEFO·배치 잔량은 다루지 않는다 — 현재고 단일값(stock)은 모듈 ①의 권위값으로 유지.

**Tech Stack:** Next.js 16 (React 19, client component) · Supabase(Postgres, plpgsql RPC) · TypeScript · vitest · Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-06-06-expiry-tracking-design.md](../specs/2026-06-06-expiry-tracking-design.md)

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|----------|
| `lib/inventory.ts` | 순수 로직: `daysUntil`(KST)·`expiryAlert`(D-3 경보 판정). supabase import 없음. | 수정(추가) |
| `lib/inventory.test.ts` | 위 두 함수 단위 테스트(경계·KST). | 수정(추가) |
| `supabase/migration-expiry-tracking.sql` | `expiry_date` 컬럼 + `stock_adjust` drop→create(5인자)→grant + 검증 SQL. 수동 적용. | 신규 |
| `lib/inventory-data.ts` | `StockMovement.expiry_date`, `loadMovements` select 확장, 신규 `loadExpiries`, `stockAdjust` 에 선택 `expiry`. | 수정(추가) |
| `components/InventoryPanel.tsx` | 입고 폼 유통기한 입력 + 행 배지(🔴만료/🟠임박) + 요약 칩 + 이력 유통기한. | 수정 |

**보존(절대 변경 금지):** `stock_adjust` 기존 본문(is_admin·`for update`·음수 차단·무제한 거부·note 정규화), `stock_ship_out`, 스토어프론트·배송 로직. 모듈 ①의 `nextStock`·`isLowStock`도 변경 금지.

---

## Chunk 1: 순수 로직 (TDD)

### Task 1: `daysUntil` — KST 달력일 차

**Files:**
- Modify: `lib/inventory.ts`
- Test: `lib/inventory.test.ts`

규칙(스펙 §순수 로직): `daysUntil(expiry: string /* 'YYYY-MM-DD' */, today: Date): number` = **KST(UTC+9) 달력일 차**. 오늘 만료=0, 내일=+1, 지남=음수. [renewal-retention.ts](../../../lib/renewal-retention.ts)의 `kstDaysUntil` 방식(`Date.UTC` 에폭 차)을 그대로 따른다 → Netlify(UTC) 자정 경계 off-by-one 방지.

- [ ] **Step 1: 실패 테스트 추가** — `lib/inventory.test.ts` 하단에 추가

```typescript
import { isLowStock, nextStock, MOVEMENT_KINDS, daysUntil } from "./inventory";

describe("daysUntil (KST)", () => {
  it("오늘 만료 → 0", () => {
    // 2026-06-10T01:00 KST = 2026-06-09T16:00Z. KST 오늘은 6/10.
    expect(daysUntil("2026-06-10", new Date("2026-06-09T16:00:00Z"))).toBe(0);
  });
  it("내일 만료 → +1", () => {
    // 2026-06-09T23:00 KST = 2026-06-09T14:00Z. KST 오늘 6/9, 만료 6/10.
    expect(daysUntil("2026-06-10", new Date("2026-06-09T14:00:00Z"))).toBe(1);
  });
  it("지난 유통기한 → 음수", () => {
    expect(daysUntil("2026-06-08", new Date("2026-06-10T03:00:00Z"))).toBe(-2);
  });
});
```

> 주의: 기존 `import { isLowStock, nextStock, MOVEMENT_KINDS } from "./inventory";` 줄에 `daysUntil` 을 합친다(중복 import 금지).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: FAIL (`daysUntil` 미존재).

- [ ] **Step 3: 최소 구현** — `lib/inventory.ts` 에 추가

```typescript
// 유통기한('YYYY-MM-DD', KST)까지 남은 KST 달력일. 오늘=0, 내일=+1, 지남=음수.
//   renewal-retention.ts 의 kstDaysUntil 과 동일 방식(UTC+9, Date.UTC 에폭 차) — UTC 실행 off-by-one 방지.
export function daysUntil(expiry: string, today: Date): number {
  const [y, m, d] = expiry.split("-").map(Number);
  const expiryEpoch = Date.UTC(y, m - 1, d);
  const k = new Date(today.getTime() + 9 * 60 * 60 * 1000);
  const todayEpoch = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return Math.round((expiryEpoch - todayEpoch) / 86_400_000);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/inventory.ts lib/inventory.test.ts
git commit -m "feat(expiry): KST 달력일 차 daysUntil (TDD)"
```

### Task 2: `expiryAlert` — D-3 임박/만료 판정

**Files:**
- Modify: `lib/inventory.ts`
- Test: `lib/inventory.test.ts`

규칙(스펙): `expiryAlert(expiries: string[], today: Date, warnDays = 3): { status, nearest, days }`
- 미래분(`daysUntil >= 0`)이 있으면 → nearest = 그중 유통기한 최솟값, days = `daysUntil(nearest)`, status = `days <= warnDays ? 'warning' : 'ok'`.
- 미래분이 없고 과거만 있으면 → status='expired', nearest = 가장 최근 과거 날짜, days < 0.
- 비면 → `{ status:'none', nearest:null, days:null }`. (호출 전 경계에서 빈/잘못된 문자열 제거.)

- [ ] **Step 1: 실패 테스트 추가** — `lib/inventory.test.ts`

```typescript
import { isLowStock, nextStock, MOVEMENT_KINDS, daysUntil, expiryAlert } from "./inventory";

describe("expiryAlert (D-3)", () => {
  const today = new Date("2026-06-10T03:00:00Z"); // KST 6/10 정오
  it("오늘 만료(days=0) → warning", () => {
    expect(expiryAlert(["2026-06-10"], today)).toEqual({ status: "warning", nearest: "2026-06-10", days: 0 });
  });
  it("D-3 경계(days=3) → warning", () => {
    expect(expiryAlert(["2026-06-13"], today).status).toBe("warning");
  });
  it("D-4(days=4) → ok", () => {
    expect(expiryAlert(["2026-06-14"], today)).toEqual({ status: "ok", nearest: "2026-06-14", days: 4 });
  });
  it("여러 개면 가장 임박한 미래분 기준", () => {
    expect(expiryAlert(["2026-07-20", "2026-06-12"], today)).toEqual({ status: "warning", nearest: "2026-06-12", days: 2 });
  });
  it("전부 과거 → expired(가장 최근 과거)", () => {
    const r = expiryAlert(["2026-06-01", "2026-06-08"], today);
    expect(r.status).toBe("expired");
    expect(r.nearest).toBe("2026-06-08");
    expect(r.days).toBeLessThan(0);
  });
  it("빈 배열 → none", () => {
    expect(expiryAlert([], today)).toEqual({ status: "none", nearest: null, days: null });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run lib/inventory.test.ts` · Expected: FAIL (`expiryAlert` 미존재).

- [ ] **Step 3: 최소 구현** — `lib/inventory.ts` 에 추가

```typescript
export type ExpiryStatus = "expired" | "warning" | "ok" | "none";
export type ExpiryAlert = { status: ExpiryStatus; nearest: string | null; days: number | null };

// 제품의 유통기한 목록 → 경보 상태. 미래분이 있으면 가장 임박한 것 기준(D-warnDays 이내=warning),
//   미래분이 없고 과거만 있으면 expired, 비면 none. (배치 잔량은 보지 않음 — 스펙 approach B.)
export function expiryAlert(
  expiries: string[],
  today: Date,
  warnDays = 3
): ExpiryAlert {
  if (expiries.length === 0) return { status: "none", nearest: null, days: null };
  const withDays = expiries.map((e) => ({ e, d: daysUntil(e, today) }));
  const upcoming = withDays.filter((x) => x.d >= 0).sort((a, b) => a.d - b.d);
  if (upcoming.length > 0) {
    const { e, d } = upcoming[0];
    return { status: d <= warnDays ? "warning" : "ok", nearest: e, days: d };
  }
  // 전부 과거 → 가장 최근 과거(=d 최댓값).
  const latestPast = withDays.sort((a, b) => b.d - a.d)[0];
  return { status: "expired", nearest: latestPast.e, days: latestPast.d };
}
```

- [ ] **Step 4: 통과 확인 + tsc** — Run: `npx vitest run lib/inventory.test.ts && npx tsc --noEmit` · Expected: PASS, 0 errors.

- [ ] **Step 5: 커밋**

```bash
git add lib/inventory.ts lib/inventory.test.ts
git commit -m "feat(expiry): D-3 임박/만료 판정 expiryAlert (TDD)"
```

---

## Chunk 2: DB 마이그레이션 (컬럼 + RPC 재생성 + 검증 SQL)

> 수동 적용 · **커밋 전 사용자 승인** · PUBLIC repo 시크릿 금지.
> ⚠️ **CRITICAL**: drop(4인자)→create(5인자)→grant(5인자) 3단계를 모두 해야 모듈 ①이 안 깨진다(grant 누락=permission denied, 두 시그니처 공존=PGRST203).

### Task 3: 마이그레이션 파일 작성

**Files:**
- Create: `supabase/migration-expiry-tracking.sql`

- [ ] **Step 1: 컬럼 + RPC 재생성** — 파일 작성

```sql
-- ─────────────────────────────────────────────────────────────
-- 물류 ERP ② 유통기한 임박 경보(경량)
--   stock_movements 입고 행에 유통기한을 스탬프하고, stock_adjust 에 선택 인자 p_expiry 추가.
--   FEFO·배치 잔량 없음. 현재고(stock) 단일값은 모듈 ① 권위값 유지.
--
--   ⚠️ stock_adjust 는 4→5 인자로 바뀐다. 반드시 drop(4인자)→create(5인자)→grant(5인자).
--      · 두 시그니처 공존 시 모듈 ① 4-인자 호출이 PGRST203 으로 실패.
--      · grant 누락 시 permission denied for function stock_adjust.
--   본문은 migration-inventory-ledger.sql 의 stock_adjust 를 그대로 복사 + 유통기한 2줄만 추가.
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 유통기한 컬럼(입고 행에만 의미. NULL=미지정).
alter table public.stock_movements
  add column if not exists expiry_date date;

-- 2) 옛 4-인자 함수 제거(명시 시그니처). 모듈 ① grant 도 함께 사라짐 → 3)에서 재부여.
drop function if exists public.stock_adjust(text, integer, text, text);

-- 3) 5-인자 재생성: 기존 본문 100% 보존 + 유통기한 처리만 추가.
create function public.stock_adjust(
  p_product_id text,
  p_delta      integer,
  p_kind       text,
  p_note       text default null,
  p_expiry     date default null
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
  -- 유통기한: 입고일 때만 의미. 이미 지난 날짜로는 입고 불가.
  if p_kind = '입고' and p_expiry is not null and p_expiry < current_date then
    raise exception '이미 만료된 유통기한입니다: %', p_expiry;
  end if;

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
  -- expiry_date 는 입고일 때만 저장(다른 유형이 stray expiry 를 보내도 null).
  insert into public.stock_movements (product_id, delta, kind, note, expiry_date, created_by)
    values (p_product_id, p_delta, p_kind,
            nullif(trim(coalesce(p_note,'')),''),
            case when p_kind = '입고' then p_expiry else null end,
            auth.uid());

  return jsonb_build_object('product_id', p_product_id, 'stock', v_new);
end;
$$;

-- 4) 새 시그니처에 grant 재부여(필수).
grant execute on function public.stock_adjust(text, integer, text, text, date) to authenticated;
```

- [ ] **Step 2: 하단 검증 SQL(레드-그린, 롤백판 — 결과를 행으로 반환)** — 파일에 이어서 주석 + 함수

```sql
-- ── 검증(수동) — 아래 함수 생성 후 select 로 실행. 자기 데이터 정리 → 실재고 무변. ──
-- create or replace function public._rg_expiry_check() returns table(check_name text, result text, detail text)
-- language plpgsql as $$
-- declare v_admin uuid; v_pid text:='milk-180'; v_cnt int; v_blocked boolean:=false; o_s int; o_sf int; v_mid uuid;
-- begin
--   select id into v_admin from public.profiles where is_admin limit 1;
--   if v_admin is null then check_name:='준비'; result:='FAIL'; detail:='관리자 없음'; return next; return; end if;
--   perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
--   select stock, safety_stock into o_s, o_sf from public.product_catalog where id=v_pid;
--   update public.product_catalog set stock=10 where id=v_pid;
--
--   -- ① 오버로드 단일성(PGRST203 방지): stock_adjust 는 정확히 1개여야.
--   select count(*) into v_cnt from pg_proc where proname='stock_adjust';
--   check_name:='① 오버로드 1개'; result:=case when v_cnt=1 then 'PASS' else 'FAIL' end; detail:=format('count=%s',v_cnt); return next;
--
--   -- ② grant(authenticated execute) 존재: permission denied 방지.
--   check_name:='② grant'; result:=case when has_function_privilege('authenticated','public.stock_adjust(text,integer,text,text,date)','execute') then 'PASS' else 'FAIL' end; detail:=''; return next;
--
--   -- ③ 4-인자 하위호환(positional 4개 → 5번째 default): 모듈 ① 경로.
--   perform public.stock_adjust(v_pid, 5, '입고', '4arg');
--   check_name:='③ 4인자 호환'; result:='PASS'; detail:='예외 없음'; return next;
--
--   -- ④ 입고 시 유통기한 저장.
--   perform public.stock_adjust(v_pid, 3, '입고', 'RG유통', current_date + 5);
--   select count(*) into v_cnt from public.stock_movements
--     where product_id=v_pid and note='RG유통' and expiry_date = current_date + 5;
--   check_name:='④ 유통기한 저장'; result:=case when v_cnt=1 then 'PASS' else 'FAIL' end; detail:=format('matched=%s',v_cnt); return next;
--
--   -- ⑤ 만료일자 입고 거부.
--   begin perform public.stock_adjust(v_pid, 1, '입고', 'RG과거', current_date - 1);
--   exception when others then v_blocked:=true; end;
--   check_name:='⑤ 만료일 입고거부'; result:=case when v_blocked then 'PASS' else 'FAIL' end; detail:=''; return next;
--
--   -- 정리(자기가 만든 movement 삭제 + 현재고 원복)
--   delete from public.stock_movements where note in ('4arg','RG유통','RG과거');
--   update public.product_catalog set stock=o_s, safety_stock=o_sf where id=v_pid;
--   return;
-- end $$;
-- select * from public._rg_expiry_check();
-- drop function public._rg_expiry_check();
```

- [ ] **Step 3: 사용자에게 적용 + 검증 요청** — 파일 전체 실행 + `_rg_expiry_check` 5행 결과(①~⑤ 전부 PASS) 회신 요청. ③(4인자 호환)·②(grant)가 PASS여야 모듈 ① 무손상 확인.

- [ ] **Step 4: 커밋(사용자 승인 후)**

```bash
git add supabase/migration-expiry-tracking.sql
git commit -m "feat(expiry): 유통기한 마이그레이션(expiry_date + stock_adjust 5인자 재생성)"
```

---

## Chunk 3: 데이터 접근 (`lib/inventory-data.ts`)

### Task 4: 타입·쿼리·래퍼 확장

**Files:**
- Modify: `lib/inventory-data.ts`

- [ ] **Step 1: `StockMovement` 에 `expiry_date` 추가 + `loadMovements` select 확장**

`StockMovement` 타입에 한 줄:
```typescript
  note: string | null;
  expiry_date: string | null;   // 입고 행만 값, 그 외 null
  created_at: string;
```
`loadMovements` 의 select 문자열에 `expiry_date` 추가:
```typescript
      .select("id, product_id, delta, kind, ref_order_id, note, expiry_date, created_at")
```

- [ ] **Step 2: 신규 `loadExpiries` 추가** — `lib/inventory-data.ts`

```typescript
// 제품별 유통기한 목록(경보용). 입고 행 중 유통기한이 막 지난 것(−7일)부터 미래까지.
//   필터는 expiry_date 기준(created_at 아님) — 유통기한 긴 품목의 임박분을 놓치지 않기 위함.
export async function loadExpiries(): Promise<Map<string, string[]>> {
  try {
    const sb = getSupabase();
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceISO = since.toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("stock_movements")
      .select("product_id, expiry_date")
      .eq("kind", "입고")
      .not("expiry_date", "is", null)
      .gte("expiry_date", sinceISO);
    if (error) throw error;
    const map = new Map<string, string[]>();
    for (const r of data ?? []) {
      const arr = map.get(r.product_id) ?? [];
      arr.push(r.expiry_date as string);
      map.set(r.product_id, arr);
    }
    return map;
  } catch (error) {
    console.error("유통기한 조회 실패:", error);
    throw new Error("유통기한 정보를 불러오지 못했습니다.");
  }
}
```

- [ ] **Step 3: `stockAdjust` 래퍼에 선택 `expiry` 추가**

```typescript
export async function stockAdjust(
  productId: string,
  delta: number,
  kind: MovementKind,
  note?: string,
  expiry?: string
): Promise<number> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("stock_adjust", {
      p_product_id: productId,
      p_delta: delta,
      p_kind: kind,
      p_note: note ?? null,
      p_expiry: expiry ?? null,
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
```

- [ ] **Step 4: tsc 검증** — Run: `npx tsc --noEmit` · Expected: 0 errors.

- [ ] **Step 5: 커밋**

```bash
git add lib/inventory-data.ts
git commit -m "feat(expiry): 유통기한 조회 loadExpiries + stockAdjust expiry 인자"
```

---

## Chunk 4: InventoryPanel UI

### Task 5: 입고 유통기한 입력 + 경보 배지·칩 + 이력

**Files:**
- Modify: `components/InventoryPanel.tsx`

- [ ] **Step 1: import·로드 확장**
  - import 에 `expiryAlert`(from `@/lib/inventory`), `loadExpiries`(from `@/lib/inventory-data`) 추가.
  - 상태 추가: `const [expiries, setExpiries] = useState<Map<string, string[]>>(new Map());`, `const [now] = useState(() => new Date());`
  - 마운트 `Promise.all` 에 `loadExpiries()` 추가 → `setExpiries`. (입고 기록 성공 후에도 `setExpiries(await loadExpiries())` 갱신.)
  - `ActionDraft` 에 `expiry: string` 추가, `EMPTY_DRAFT` 에 `expiry: ""`.

- [ ] **Step 2: 입고 폼에 유통기한 입력(유형='입고'일 때만)** — 거래 입력 셀의 수량 input 근처에 추가

```tsx
{d.kind === "입고" && (
  <input
    type="date"
    value={d.expiry}
    onChange={(e) => patchDraft(p.id, { expiry: e.target.value })}
    title="유통기한(선택)"
    className="rounded-lg border border-line bg-cream px-2 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
  />
)}
```

- [ ] **Step 3: `recordMovement` 에서 expiry 전달** — `stockAdjust` 호출 수정

```typescript
      const newStock = await stockAdjust(
        p.id, delta, d.kind, d.note,
        d.kind === "입고" && d.expiry ? d.expiry : undefined
      );
      // ... 기존 setRows/draft 초기화 후:
      setMovements(await loadMovements());
      setExpiries(await loadExpiries());
```

- [ ] **Step 4: 행 유통기한 배지(`stock>0` 관리 품목만)** — 현재고 셀 또는 상품 셀에 추가

```tsx
{managed && p.stock! > 0 && (() => {
  const a = expiryAlert(expiries.get(p.id) ?? [], now);
  if (a.status === "expired")
    return <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">🔴 만료</span>;
  if (a.status === "warning")
    return <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">🟠 임박 D-{a.days} (유통 {a.nearest?.slice(5).replace("-", "/")})</span>;
  return null;
})()}
```

- [ ] **Step 5: 상단 요약 칩(임박·만료 제품 수)** — `lowCount` 옆에 추가(같은 패턴)

```typescript
const expiryCounts = useMemo(() => {
  let warning = 0, expired = 0;
  for (const r of rows) {
    if (r.stock === null || r.stock <= 0) continue;
    const s = expiryAlert(expiries.get(r.id) ?? [], now).status;
    if (s === "warning") warning++;
    else if (s === "expired") expired++;
  }
  return { warning, expired };
}, [rows, expiries, now]);
```
칩 렌더: `expiryCounts.expired > 0` → 🔴만료 N, `expiryCounts.warning > 0` → 🟠임박 N.

- [ ] **Step 6: 원장 이력에 유통기한 표기** — 사유 셀 또는 유형 옆에 `m.expiry_date` 작게(`입고`이고 값 있을 때): `{m.expiry_date && <span className="text-mute"> · 유통 {m.expiry_date.slice(5)}</span>}`.

- [ ] **Step 7: tsc + lint** — Run: `npx tsc --noEmit && npx eslint components/InventoryPanel.tsx lib/inventory.ts lib/inventory-data.ts` · Expected: 0 errors.

- [ ] **Step 8: 커밋**

```bash
git add components/InventoryPanel.tsx
git commit -m "feat(expiry): InventoryPanel 입고 유통기한 입력 + 임박/만료 배지·칩·이력"
```

---

## Chunk 5: 통합 검증 + 마무리

### Task 6: 전체 검증

- [ ] **Step 1: 전체 테스트** — Run: `npm test` · Expected: 기존 + expiry 신규 전부 PASS.
- [ ] **Step 2: tsc** — Run: `npx tsc --noEmit` · Expected: 0 errors.
- [ ] **Step 3: 빌드** — Run: `npm run build` · Expected: exit 0.
- [ ] **Step 4: 요구사항 체크리스트**(스펙 §검증):
  - [ ] `expiry_date` 컬럼 + `stock_adjust` 5인자(drop→create→grant) + 입고만 저장(case-when)
  - [ ] `daysUntil`(KST)·`expiryAlert`(D-3) 경계·off-by-one 테스트 green
  - [ ] 입고 폼 유통기한 입력 / 🔴만료·🟠임박 배지(stock>0) / 요약 칩 / 이력 유통기한
  - [ ] 모듈 ① 4-인자 호환(③)·grant(②) PASS → 기존 입출고 무손상
  - [ ] 만료일자 입고 거부(⑤)
- [ ] **Step 5: 코드 리뷰** — superpowers:requesting-code-review (또는 code-reviewer/security-reviewer). CRITICAL/HIGH 해결.
- [ ] **Step 6: 사용자 승인 → main push → Netlify.**

---

## Remember
- DRY / YAGNI / TDD / 잦은 커밋 / 외과적(요청 라인만).
- 불변성: 상태·객체 갱신은 spread.
- 마이그레이션 수동 적용 + 커밋 전 승인. PUBLIC repo 시크릿 금지.
- `stock_adjust` 본문은 모듈 ① 복사 + 유통기한 2줄만 추가. drop→create→**grant** 3단계 필수.
