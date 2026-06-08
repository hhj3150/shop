# 추천 적립금(쿠폰) 자동 선차감 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 추천 보상 5,000원을 현금이 아니라 "다음 주문에서 5,000원 단위·입금액 한도까지 자동 차감되는 적립금"으로 지급하고, 1년 만료·취소 시 미사용분만 회수한다.

**Architecture:** 적립 원장(`referral_rewards`)에 만료·사용추적·회수링크를 추가하고(Phase 1), 순수 차감 계산을 `lib/referral-credit.ts`(TDD)로 분리한 뒤 SQL `apply_referral_credit()`를 3개 주문 RPC에 삽입해 서버 권위로 차감한다(Phase 2). 취소 회수는 RPC 본문을 건드리지 않고 `subscription_slots`·`order_returns` AFTER UPDATE 트리거로 처리한다.

**Tech Stack:** Next.js(App Router, webpack), TypeScript, Vitest, Supabase Postgres(plpgsql, security definer RPC/트리거). 마이그레이션은 **수기 적용 SQL**(supabase/migration-*.sql, 멱등). 빌드 게이트 = `next build` + `tsc --noEmit` + `vitest run`.

**Spec:** [docs/superpowers/specs/2026-06-08-referral-credit-redemption-design.md](../specs/2026-06-08-referral-credit-redemption-design.md)

**관련 스킬:** @superpowers:test-driven-development

> ⚠ **SQL은 자동 검증 불가**: 마이그레이션은 사장님이 Supabase SQL Editor에 수기 적용한다([[project_supabase_manual_migrations]]). 따라서 SQL 작업의 "검증"은 마이그레이션 파일 + 동봉한 수기 검증 쿼리로 갈음하고, 빌드 게이트(next build/tsc/vitest)는 TS 변경에만 적용된다. SQL 파일은 멱등(`create or replace`, `add column if not exists`)으로 작성한다.

---

## 파일 구조

- **Create** `lib/referral-credit.ts` (신규) — 순수 함수: `usableBalance`(유효 잔액), `redeemableCoupons`(차감 계산). React/Supabase 비의존.
- **Create** `lib/referral-credit.test.ts` (신규) — 단위 테스트.
- **Create** `supabase/migration-referral-credit-ledger.sql` (신규, Phase 1) — 스키마 alter + 적립 트리거 보강 + 회수 함수·트리거.
- **Create** `supabase/migration-referral-credit-redeem.sql` (신규, Phase 2) — `apply_referral_credit()` + 3개 주문 RPC 삽입.
- **Modify** `components/ReferralCard.tsx` (Phase 1) — `expires_at` 조회 + 유효 잔액·만료 임박 표시.
- **Modify** `app/checkout/page.tsx`, `app/orders/complete/page.tsx` (Phase 2) — 적립금 차감액·최종 입금액 표시.

---

## Chunk 1: Phase 1 — 원장 정확성(만료·회수)

독립 PR. 적립금 "사용"은 아직 없지만, **만료일이 박히고 취소 시 미사용분이 회수되는 올바른 원장**이 완성된다.

### Task 1: 순수 함수 `lib/referral-credit.ts` (TDD)

전체 적립금 순수 로직을 한 번에 만들고 테스트한다(usableBalance는 Phase 1 카드에서, redeemableCoupons는 Phase 2 차감에서 사용).

**Files:**
- Create: `lib/referral-credit.ts`
- Test: `lib/referral-credit.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/referral-credit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { usableBalance, redeemableCoupons, type RewardLite } from "./referral-credit";

const NOW = "2026-06-08T00:00:00Z";
function rw(over: Partial<RewardLite> = {}): RewardLite {
  return { amount_krw: 5000, status: "earned", expires_at: "2027-01-01T00:00:00Z", ...over };
}

describe("usableBalance", () => {
  it("유효(earned·미만료)만 합산한다", () => {
    const b = usableBalance(
      [rw(), rw(), rw({ status: "applied" }), rw({ status: "void" })],
      NOW
    );
    expect(b).toEqual({ count: 2, krw: 10000 });
  });
  it("만료된 earned 는 제외한다", () => {
    const b = usableBalance([rw({ expires_at: "2026-01-01T00:00:00Z" }), rw()], NOW);
    expect(b).toEqual({ count: 1, krw: 5000 });
  });
  it("만료 경계(만료일 == now)는 만료로 본다", () => {
    const b = usableBalance([rw({ expires_at: NOW })], NOW);
    expect(b).toEqual({ count: 0, krw: 0 });
  });
  it("빈 배열이면 0", () => {
    expect(usableBalance([], NOW)).toEqual({ count: 0, krw: 0 });
  });
});

describe("redeemableCoupons", () => {
  it("입금액 한도 내에서 5,000원 단위로 차감한다", () => {
    // 입금액 32,400 · 잔액 10장 → 6장(30,000) 차감, 2,400 입금
    expect(redeemableCoupons({ availableCount: 10, orderTotal: 32400 })).toEqual({
      useCount: 6,
      creditKrw: 30000,
      payable: 2400,
    });
  });
  it("잔액이 부족하면 가진 만큼만", () => {
    expect(redeemableCoupons({ availableCount: 2, orderTotal: 50000 })).toEqual({
      useCount: 2,
      creditKrw: 10000,
      payable: 40000,
    });
  });
  it("정확히 배수면 0원 입금", () => {
    expect(redeemableCoupons({ availableCount: 10, orderTotal: 30000 })).toEqual({
      useCount: 6,
      creditKrw: 30000,
      payable: 0,
    });
  });
  it("잔액 0장이면 차감 없음", () => {
    expect(redeemableCoupons({ availableCount: 0, orderTotal: 30000 })).toEqual({
      useCount: 0,
      creditKrw: 0,
      payable: 30000,
    });
  });
  it("payable 은 항상 0 이상", () => {
    const r = redeemableCoupons({ availableCount: 100, orderTotal: 27000 });
    expect(r.payable).toBeGreaterThanOrEqual(0);
    expect(r.creditKrw).toBeLessThanOrEqual(27000);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/referral-credit.test.ts`
Expected: FAIL — `Cannot find module './referral-credit'`.

- [ ] **Step 3: 최소 구현**

`lib/referral-credit.ts`:

```ts
// 추천 적립금(쿠폰) 순수 계산. 쿠폰 1장 = 5,000원. React/Supabase 비의존 — 단위 테스트 대상.
//   잔액·차감 규칙의 단일 출처. SQL(apply_referral_credit)과 동일 규칙을 유지한다.
export const COUPON_KRW = 5000;

// 잔액 계산에 필요한 적립건의 최소 형태(referral_rewards 부분집합).
export type RewardLite = {
  amount_krw: number;
  status: string; // 'earned' | 'applied' | 'void'
  expires_at: string | null;
};

// 유효 잔액 = status='earned' 이고 아직 만료되지 않은(만료일 > now) 적립건. 만료 경계(==)는 만료로 본다.
export function usableBalance(
  rewards: RewardLite[],
  nowISO: string
): { count: number; krw: number } {
  const now = new Date(nowISO).getTime();
  let count = 0;
  for (const r of rewards) {
    if (r.status !== "earned") continue;
    if (r.expires_at !== null && new Date(r.expires_at).getTime() <= now) continue;
    count += 1;
  }
  return { count, krw: count * COUPON_KRW };
}

// 입금액 한도 내에서 5,000원 단위로 차감할 쿠폰 수를 계산한다(쿠폰을 쪼개지 않음).
//   useCount = min(보유 유효 장수, floor(입금액 / 5000)). payable 은 항상 0 이상.
export function redeemableCoupons(input: {
  availableCount: number;
  orderTotal: number;
}): { useCount: number; creditKrw: number; payable: number } {
  const fit = Math.floor(Math.max(0, input.orderTotal) / COUPON_KRW);
  const useCount = Math.max(0, Math.min(input.availableCount, fit));
  const creditKrw = useCount * COUPON_KRW;
  return { useCount, creditKrw, payable: input.orderTotal - creditKrw };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/referral-credit.test.ts`
Expected: PASS (10 passed).

- [ ] **Step 5: 커밋**

```bash
git add lib/referral-credit.ts lib/referral-credit.test.ts
git commit -m "feat: 추천 적립금 순수 계산(usableBalance·redeemableCoupons, TDD)"
```

---

### Task 2: 원장 마이그레이션 `migration-referral-credit-ledger.sql`

**Files:**
- Create: `supabase/migration-referral-credit-ledger.sql`

기존 `migration-referral-program.sql`을 읽어 트리거 함수 `referral_qualify_on_order_paid`의 현재 본문을 확인한 뒤(이 마이그레이션이 그 함수를 `create or replace`로 보강), 아래를 작성한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migration-referral-credit-ledger.sql`:

```sql
-- ─────────────────────────────────────────────────────────────
-- 추천 적립금 — Phase 1: 원장 정확성(만료·회수). additive·멱등.
--   • referral_rewards: expires_at(적립+1년)·applied_order_id
--   • referrals: qualifying_order_id(친구 첫 구독 주문 — 회수 대상 식별)
--   • orders: referral_credit_krw(차감액 기록; 사용은 Phase 2)
--   • 적립 트리거 보강: expires_at·qualifying_order_id 채움
--   • 회수: void_referral_rewards_for_order() + 슬롯 해지/환불 완료 트리거(미사용분만)
--   ⚠ 보상 금액·기간은 lib 와 동기화: 쿠폰 5,000원, 만료 1년.
-- ─────────────────────────────────────────────────────────────

-- 1) 컬럼 추가(멱등).
alter table public.referral_rewards
  add column if not exists expires_at timestamptz,
  add column if not exists applied_order_id uuid references public.orders (id);
alter table public.referrals
  add column if not exists qualifying_order_id uuid references public.orders (id);
alter table public.orders
  add column if not exists referral_credit_krw int not null default 0;

-- 2) 기존 earned 행에 만료일 백필(없으면 created_at + 1년).
update public.referral_rewards
   set expires_at = created_at + interval '1 year'
 where expires_at is null;

-- 3) 적립 트리거 보강 — qualifying_order_id(추천) + expires_at(적립건) 채움.
--    ★ 기존 동작(친구 첫 구독 입금확인 시 양쪽 earned) 유지 + 위 두 값만 추가.
--    ★ 머니 플로우 보호: 예외 전부 무시(주문 확정을 막지 않음) — 기존과 동일.
create or replace function public.referral_qualify_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_amt int;
  v_exp timestamptz := now() + interval '1 year';
begin
  begin
    if new.order_type = '구독' and new.status = '입금확인' then
      select * into v_ref from public.referrals
        where referee_id = new.user_id and status = 'pending'
        for update skip locked;
      if found then
        v_amt := public.referral_reward_amount();
        update public.referrals
           set status = 'qualified', qualified_at = now(), qualifying_order_id = new.id
         where id = v_ref.id;
        insert into public.referral_rewards (referral_id, user_id, role, amount_krw, status, expires_at)
        values (v_ref.id, v_ref.referrer_id, 'referrer', v_amt, 'earned', v_exp),
               (v_ref.id, v_ref.referee_id,  'referee',  v_amt, 'earned', v_exp)
        on conflict (referral_id, role) do nothing;
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

-- 4) 회수 함수 — 한 주문(친구 첫 구독)이 취소/환불되면 그 추천의 미사용분만 void.
--    양쪽(referrer·referee) earned 만 void. applied(쓴 것)·void 는 건드리지 않음(방안 ㉠). 멱등.
create or replace function public.void_referral_rewards_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.referral_rewards rw
     set status = 'void'
    from public.referrals r
   where rw.referral_id = r.id
     and r.qualifying_order_id = p_order_id
     and rw.status = 'earned';
end;
$$;

-- 5) 트리거: 구독 슬롯이 '해지'로 바뀌면 그 슬롯의 원주문 기준 회수.
--    ★ cancel_subscription 본문을 건드리지 않고 슬롯 상태 변화를 잡는다(드리프트 방지).
create or replace function public.trg_referral_void_on_slot_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = '해지' and coalesce(old.status, '') <> '해지' and new.order_id is not null then
    perform public.void_referral_rewards_for_order(new.order_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_referral_void_slot on public.subscription_slots;
create trigger trg_referral_void_slot
  after update on public.subscription_slots
  for each row execute function public.trg_referral_void_on_slot_cancel();

-- 6) 트리거: 환불(order_returns)이 '완료'로 바뀌면 그 주문 기준 회수.
create or replace function public.trg_referral_void_on_return_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = '환불' and new.status = '완료' and coalesce(old.status, '') <> '완료' then
    perform public.void_referral_rewards_for_order(new.order_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_referral_void_return on public.order_returns;
create trigger trg_referral_void_return
  after update on public.order_returns
  for each row execute function public.trg_referral_void_on_return_done();

-- ───────── 수기 검증(적용 후 SQL Editor 에서) ─────────
--   -- (a) 신규 적립건에 만료일·qualifying 채워지는지: 친구 첫 구독 입금확인 후
--   --     select expires_at from referral_rewards order by created_at desc limit 2;  -- 약 1년 뒤
--   --     select qualifying_order_id from referrals order by created_at desc limit 1; -- 그 주문 id
--   -- (b) 미사용 상태에서 슬롯 해지 → 양쪽 earned 가 void 되는지:
--   --     해당 referral 의 referral_rewards.status 가 모두 'void' 인지 확인.
--   -- (c) ★이미 applied(써버린) 뒤 해지 → void 되지 않는지(분쟁 핵심):
--   --     applied 행은 그대로 'applied' 유지되어야 함.
```

- [ ] **Step 2: 마이그레이션 멱등성 점검(눈검사)**

`add column if not exists` / `create or replace` / `drop trigger if exists` 패턴만 썼는지 확인. 같은 파일을 두 번 실행해도 안전해야 한다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migration-referral-credit-ledger.sql
git commit -m "feat: 추천 적립금 원장 — 만료일·회수 트리거(Phase 1, SQL)"
```

> 적용은 사장님이 SQL Editor 에서 1회 실행 후 검증 쿼리 (a)(b)(c) 확인. 코드 머지와 별개.

---

### Task 3: 마이페이지 카드 — 유효 잔액·만료 임박 (`components/ReferralCard.tsx`)

**Files:**
- Modify: `components/ReferralCard.tsx`

먼저 현재 파일을 읽어 `referral_rewards` 조회부(약 31–32행: `.select("amount_krw,status")`)와 earned/applied 합산부(약 50–55행)를 확인한다. **`Reward` 타입 별칭(약 13행 `{ amount_krw; status }`)에 `expires_at: string | null`도 추가**해야 `usableBalance` 호출이 타입체크된다.

- [ ] **Step 1: 조회에 expires_at 추가 + 유효 잔액 계산으로 교체**

조회 select 를 `amount_krw,status,expires_at` 로 바꾸고, 기존 "earned 단순 합산"을 `usableBalance(rewards, new Date().toISOString())` 로 교체한다(만료건 제외). 표시 라벨 "받은 보상(지급 예정)"은 **"사용 가능 적립금"**(유효 잔액)으로, 값은 `usableBalance(...).krw`. `applied` 합계(적용 완료)는 유지.

```tsx
import { usableBalance } from "@/lib/referral-credit";
// ...
// rewards: { amount_krw, status, expires_at }[] 로 조회
const balance = usableBalance(rewards, new Date().toISOString());
const applied = rewards
  .filter((r) => r.status === "applied")
  .reduce((s, r) => s + r.amount_krw, 0);
// 만료 임박: 30일 이내 만료되는 earned 가 있으면 안내 문구.
const soon = rewards.some(
  (r) =>
    r.status === "earned" &&
    r.expires_at !== null &&
    new Date(r.expires_at).getTime() - Date.now() < 30 * 86_400_000 &&
    new Date(r.expires_at).getTime() > Date.now()
);
```

표시: "사용 가능 적립금 {formatKRW(balance.krw)}" + (soon 이면) "곧 만료되는 적립금이 있어요" 안내. "적용 완료 {formatKRW(applied)}" 유지. 안내 문구는 다음 결제 자동 차감을 명시: "다음 주문 때 자동으로 차감돼요."

> 외과적 변경: 조회 컬럼·합산 로직·표시 라벨만. 카드의 코드 공유·링크 등 다른 부분은 건드리지 않는다.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit 2>&1 | grep -i "ReferralCard\|referral-credit" || echo "no related type errors"`
Expected: 관련 에러 없음. (`.next/types/` 공백파일 stale 에러는 무관 — 무시.)

- [ ] **Step 3: 커밋**

```bash
git add components/ReferralCard.tsx
git commit -m "feat: 마이페이지 추천 카드 — 유효 잔액·만료 임박 표시"
```

---

### Task 4: Phase 1 빌드 게이트 + PR

- [ ] **Step 1: 게이트**

```bash
find .next/types -name "* 2.ts" -delete 2>/dev/null; true
npx vitest run            # 신규 referral-credit 포함 전체 PASS
npx tsc --noEmit          # 0 errors
npx next build --webpack  # exit 0
```

- [ ] **Step 2: 푸시 & PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: 추천 적립금 원장 — 만료·회수 + 잔액 표시 (Phase 1)" --fill
```

PR 본문에 ⚠ "SQL 마이그레이션 `migration-referral-credit-ledger.sql`을 머지 후 SQL Editor에 수기 적용 + 검증쿼리 (a)(b)(c) 확인 필요"를 명시. Netlify 빌드 통과 후 squash 머지.

---

## Chunk 2: Phase 2 — 적립금 사용(자동 선차감)

독립 PR. Phase 1 머지 + SQL 적용 후 시작. 실제로 주문 시 적립금이 차감되고 입금액이 줄어든다.

### Task 5: 차감 RPC + 주문 RPC 삽입 `migration-referral-credit-redeem.sql`

**Files:**
- Create: `supabase/migration-referral-credit-redeem.sql`

⚠ 이 작업은 **live 주문 RPC 3개의 본문을 `create or replace`로 재정의**해 삽입한다. 반드시 각 함수의 **현재 전체 본문**을 해당 파일에서 읽어 그대로 복제하고, 차감 3줄만 추가한다(로직 변경 0). 위치:
- `create_subscription_order` — `supabase/migration-order-integrity.sql` (v_total ~140행, 이후 orders insert)
- `create_once_order` — `supabase/migration-order-integrity.sql` (v_total ~255행)
- `request_renewal` — `supabase/schema.sql:512` (4-인자 live 버전, v_total 605행, insert 608행) — ⚠ `migration-*-renewal*.sql` 동명 함수는 폐기됨, 건드리지 말 것. (`migration-renewal-modify.sql:40`에 본문이 동일한 4-인자 버전이 또 있으나, **복제 출처는 `schema.sql:512` 하나로 통일**한다.)

- [ ] **Step 1: 차감 함수 작성**

`supabase/migration-referral-credit-redeem.sql` 상단:

```sql
-- ─────────────────────────────────────────────────────────────
-- 추천 적립금 — Phase 2: 자동 선차감. additive·멱등.
--   apply_referral_credit(user, total, order_id):
--     유효(earned·미만료) 쿠폰을 오래된 것부터 floor(total/5000)장까지 applied 처리
--     (applied_order_id=order_id) 하고 차감액(장수×5000)을 돌려준다.
--   주문 RPC 3개에서 v_total 계산·주문 insert 후 호출 → total_amount 를 차감액만큼 줄이고
--   orders.referral_credit_krw 에 기록. 한도 내 차감만(payable≥0). 원자 처리(실패 시 롤백).
-- ─────────────────────────────────────────────────────────────

create or replace function public.apply_referral_credit(
  p_user uuid, p_total int, p_order_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fit   int := greatest(0, p_total / 5000);  -- floor: int 나눗셈
  v_ids   uuid[];
  v_count int;
begin
  -- 유효(earned·미만료) 쿠폰을 오래된 것부터 최대 v_fit 장 잠금 선택.
  select array_agg(id) into v_ids from (
    select id from public.referral_rewards
     where user_id = p_user and status = 'earned'
       and (expires_at is null or expires_at > now())
     order by created_at asc
     limit v_fit
     for update skip locked
  ) s;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then return 0; end if;
  update public.referral_rewards
     set status = 'applied', applied_at = now(), applied_order_id = p_order_id
   where id = any(v_ids);
  return v_count * 5000;
end;
$$;
grant execute on function public.apply_referral_credit(uuid, int, uuid) to authenticated;
```

- [ ] **Step 2: 3개 주문 RPC에 삽입(각 함수 현재 본문 복제 + 3줄 추가)**

같은 마이그레이션 파일에 세 RPC를 `create or replace`로 재정의한다. **각 함수의 현재 전체 본문을 원본 파일에서 복사**한 뒤, **주문 insert 직후**(주문 id 확보 후) 아래를 추가하고 반환 total 도 차감 반영:

```sql
  -- ▼ 적립금 자동 선차감(주문 insert 직후, id 확보 상태)
  v_credit := public.apply_referral_credit(v_uid, v_total, v_order_id);
  if v_credit > 0 then
    update public.orders
       set total_amount = v_total - v_credit, referral_credit_krw = v_credit
     where id = v_order_id;
    v_total := v_total - v_credit;
  end if;
  -- ▲
```

선언부에 `v_credit int := 0;` 추가. 반환 jsonb 의 total 은 차감 후 `v_total` 을 쓴다(`fetchOrderTotal` 은 DB 의 줄어든 total_amount 를 다시 읽으므로 화면 입금액은 자동 반영). **로직은 이 3줄·1선언·반환값 외 변경 0.**

> ⚠ 원자성: `apply_referral_credit` 호출을 **`exception when others then null` 류로 감싸지 말 것**. 적립 트리거와 달리 여기선 실패가 그대로 주문 생성 트랜잭션을 롤백해야 한다(이중차감·쿠폰 유실 방지). 인라인 호출 그대로 두면 자연히 롤백된다.

> 게스트(`create_guest_once_order`)는 손대지 않는다(계정 없음 → 적립금 없음).

- [ ] **Step 3: 멱등성 점검 + 커밋**

`create or replace`만 사용했는지 확인.

```bash
git add supabase/migration-referral-credit-redeem.sql
git commit -m "feat: 추천 적립금 자동 선차감 RPC + 주문 RPC 삽입(Phase 2, SQL)"
```

수기 검증 쿼리(파일 하단 주석): 구독/단품/갱신 각각 적립금 보유 회원으로 주문 생성 → `orders.total_amount`가 5,000 단위로 줄고 `referral_credit_krw` 기록, 쿠폰 N장 `applied`+`applied_order_id` 세팅 확인. 잔액 < 입금액일 때 payable>0 확인.

---

### Task 6: 결제·완료 화면 적립금 표시

**Files:**
- Modify: `app/checkout/page.tsx`
- Modify: `app/orders/complete/page.tsx`

> 두 화면 모두 입금액은 **RPC 반환 total(차감 후)** 을 이미 쓴다. 추가로 "적립금 -N원 적용"을 보여주려면 차감액이 필요하다. 차감액은 주문 생성 응답에 담아 전달한다.

- [ ] **Step 1: 주문 생성 응답에 차감액 노출**

`lib/orders.ts`의 `createOrder`/`createOnceOrder`/renewal 호출부가 RPC 반환을 어떻게 쓰는지 읽고, `referral_credit_krw`(또는 생성된 주문에서 재조회)를 호출자에게 함께 반환하도록 최소 확장한다. (RPC 가 이미 줄인 total 을 주므로, 차감액은 생성 직후 그 주문의 `referral_credit_krw` 를 읽어 전달.)

- [ ] **Step 2: checkout/complete 표시**

`app/checkout/page.tsx`(입금액 표시 ~311행)와 `app/orders/complete/page.tsx`(~117행)에서, 차감액>0이면 "적립금 −{formatKRW(credit)} 적용 → 입금액 {formatKRW(total)}" 한 줄을 입금액 위/옆에 추가. 차감 0이면 기존과 동일(아무것도 안 보임).

> 외과적: 입금액 표시 영역에만 한 줄 추가. 다른 결제 로직·검증 손대지 않는다.

- [ ] **Step 3: 타입체크 + 커밋**

Run: `npx tsc --noEmit 2>&1 | grep -iE "checkout|complete|orders\.ts" || echo "no related type errors"`

```bash
git add app/checkout/page.tsx app/orders/complete/page.tsx lib/orders.ts
git commit -m "feat: 결제·완료 화면 적립금 차감 표시"
```

---

### Task 7: 약관 문구

**Files:**
- Modify: 추천 카드 또는 약관 위치(기존 추천 안내 문구가 있는 `components/ReferralCard.tsx` 하단 또는 약관 페이지 — 먼저 grep 으로 기존 추천 안내 문구 위치 확인).

- [ ] **Step 1: 문구 추가**

적립조건(신규·첫 정기구독·입금확인) / 쿠폰 5,000원 단위 차감 / 1년 만료 / 입금액 한도 내 차감·잔액 이월 / 취소 시 미사용분 회수 / **현금 환급 불가** 를 한 문단으로. 분쟁 방지가 목적이므로 모호어 없이.

- [ ] **Step 2: 커밋**

```bash
git add -A && git commit -m "docs: 추천 적립금 약관 문구"
```

---

### Task 8: Phase 2 빌드 게이트 + PR

- [ ] **Step 1: 게이트**

```bash
find .next/types -name "* 2.ts" -delete 2>/dev/null; true
npx vitest run && npx tsc --noEmit && npx next build --webpack
```

- [ ] **Step 2: 푸시 & PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: 추천 적립금 자동 선차감 — 주문 차감·화면·약관 (Phase 2)" --fill
```

PR 본문: ⚠ "`migration-referral-credit-redeem.sql` 머지 후 수기 적용 + 구독/단품/갱신 3경로 차감 검증쿼리 확인 필요". Netlify 통과 후 squash 머지.

---

## 검증 체크리스트 (각 Phase 완료 전)

**Phase 1**
- [ ] `vitest run lib/referral-credit.test.ts` — 10 passed
- [ ] `vitest run` / `tsc --noEmit` / `next build` 통과
- [ ] (수기 적용 후) 신규 적립건 expires_at≈+1년 · referrals.qualifying_order_id 세팅
- [ ] (수기) 미사용 해지 → 양쪽 earned void
- [ ] (수기) ★이미 applied 후 해지 → void 안 됨

**Phase 2**
- [ ] `vitest run` / `tsc --noEmit` / `next build` 통과
- [ ] (수기) 구독·단품·갱신 각각 차감 → total_amount 5,000단위↓ · referral_credit_krw 기록 · 쿠폰 applied
- [ ] (수기) 잔액<입금액일 때 payable>0, 차감은 한도 내
- [ ] 결제·완료 화면에 "적립금 −N원 적용" 표시(차감 시), 미차감 시 미표시
