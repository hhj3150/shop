# 정기구독 기간 선택 (4주 / 8주 / 12주) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 4주 고정인 정기구독을 4주·8주·12주 중 선택(할인 10%/12%/15%)하도록 확장한다.

**Architecture:** 서버 SQL 함수 `period_discount`가 금액·할인의 단일 권위다. 클라이언트(`lib/products.ts` 상수, `PurchasePanel`, `cart`)는 표시·선택용이며 RPC가 금액을 전량 재계산한다. 기존 확장 포인트(`period_discount` CASE + `p_period*4` + `block_weeks` 도출 만료일)에 외과적으로 상수만 얹는다 — 새 추상화 없음.

**Tech Stack:** Next.js 16(React, TS), Supabase Postgres(SECURITY DEFINER RPC), 커스텀 node@22 테스트 러너(`/tmp/vrun`, vitest 호환 shim — 이 머신은 vitest 4가 환경적으로 hang).

**Spec:** `docs/superpowers/specs/2026-06-03-subscription-period-selection-design.md`

---

## 사전 지식 (구현자 필독)

이 코드베이스는 처음 보는 사람을 가정한다. 아래는 반드시 알아야 할 사실들이다.

1. **서버가 금액 권위.** `supabase/schema.sql`의 `create_subscription_order(p_items, p_period, p_ship)` RPC가 주문 금액을 계산·저장한다. 핵심 로직(이미 가변 기간 지원, **변경 불필요**):
   - `v_rate := public.period_discount(p_period);` — null이면 `'구독 기간이 올바르지 않습니다.'` 예외(기간 가드).
   - `v_weeks := p_period * 4;`
   - 병당 할인단가 `v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;`
   - `v_per_delivery`(회당 상품합)가 `< 25000`이면 `'회당 최소 상품 금액은 25,000원입니다.'` 예외.
   - `v_shipping := 4000 * v_weeks;` → `v_total := v_per_delivery * v_weeks + v_shipping;`
   - 저장: `block_weeks=v_weeks`, `period_months=p_period`, `total_amount=v_total`.

2. **내부 모델은 '개월'(1/2/3), 사용자 라벨만 '주'(4/8/12).** `SubPeriod` 타입의 값은 1·2·3이고 `periodWeeks(m)=m*4`로 주차를 도출한다. `period_months`는 라벨/내부키일 뿐, 만료·환불·회차는 전부 `block_weeks`(=주차) 기준이라 의미 충돌 없음.

3. **만료·환불·재구독 알림은 `block_weeks`에서 자동 도출**된다 → 기간이 길어지면 D-7/D-3 알림·환불액이 추가 코드 없이 맞춰진다. 이 plan에서 손대지 않는다.

4. **재구독(`request_renewal`)은 의도적으로 무변경** — 항상 4주·10%로 재결제된다(spec §6·§8). 이 plan 범위 밖이며 건드리지 않는다.

5. **불변성 규칙(전역 CLAUDE.md):** 객체를 변형(mutate)하지 말고 항상 새 리터럴/객체를 만든다. 하드코딩 금지, 외과적 변경만(요청된 줄만 바꾼다).

6. **테스트 실행 방법(이 머신 전용).** `npx vitest`는 이 머신에서 hang한다. 대신 커스텀 러너를 쓴다:
   ```bash
   /opt/homebrew/opt/node@22/bin/node --experimental-strip-types \
     --experimental-loader /tmp/vrun/loader.mjs /tmp/vrun/run.mjs \
     $(find lib -name '*.test.ts' | sort)
   ```
   - 출력 끝에 `PASS: N`, `FAIL: M`, `FILES_RUN: x/y`가 찍힌다. **FAIL 0 + FILES_RUN 전부 = 통과.**
   - 단일 파일만 빠르게 보려면 끝 인자를 `lib/products.test.ts` 하나로 바꾼다.
   - 타입 게이트: `/opt/homebrew/opt/node@22/bin/npx tsc --noEmit` (exit 0). **글로벌 `node`(25)는 tsc·vitest가 hang하므로 쓰지 말 것.**

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `supabase/migration-period-weeks-tiers.sql` | 서버 권위: `period_discount` 1/2/3 → 0.10/0.12/0.15 | **신규** |
| `lib/products.ts` | 표시용 기간 옵션/라벨/할인/배지 상수·타입 | 수정(상수 3곳 + 신규 `PERIOD_BADGE` + 주석) |
| `lib/products.test.ts` | products 순수함수·상수 단위테스트 | **신규** |
| `lib/cart.tsx` | 장바구니 기본 기간 → 8주(2) | 수정(1줄) |
| `components/PurchasePanel.tsx` | 기본 선택 8주 + 기간 배지 렌더 | 수정(import + useState + 배지 span) |

각 파일은 단일 책임을 가진다. SQL=금액권위, products=상수, cart=상태, panel=UI. 서로 잘 분리됨.

---

## Chunk 1: 전체 구현

### Task 1: 서버 권위 마이그레이션 (SQL — 사장님 적용)

**Files:**
- Create: `supabase/migration-period-weeks-tiers.sql`

> SQL은 단위테스트 불가. 검증은 (a) 파일 내용 정확성, (b) 사장님이 적용 전/후 쿼리로 값 확인, (c) 적용 후 각 기간 1건 테스트주문의 `total_amount` 육안 대조다. **이 Task는 코드를 푸시/배포하지 않는다 — 파일만 작성한다. 실제 DB 적용은 사장님 수동.**

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migration-period-weeks-tiers.sql`:
```sql
-- 정기구독 기간 할인 + 허용 기간 정의 (서버 단일 권위).
--   p_months: 1=4주, 2=8주, 3=12주. 그 외는 null → create_subscription_order가 예외.
--   ⚠ 이 파일은 migration-period-3months.sql(1→0.10,2→0.11,3→0.12)을 명시적으로 대체(supersede)한다.
--   create_subscription_order / request_renewal 본문은 무변경(이미 period_discount·p_period*4 사용).
-- 멱등: create or replace. 적용 전후 라이브 주문 흐름 무중단.
create or replace function public.period_discount(p_months int)
returns numeric language sql immutable as $$
  select case p_months
    when 1 then 0.10   -- 4주
    when 2 then 0.12   -- 8주
    when 3 then 0.15   -- 12주
    else null
  end;
$$;
```

- [ ] **Step 2: 사장님 적용 절차를 파일 하단 주석으로 명시**

같은 파일 끝에 추가:
```sql

-- ───────── 사장님 적용 절차 ─────────
-- 1) 적용 전(before) 현재 값 확인 — 어느 선행 마이그레이션이 라이브인지 캡처:
--      select period_discount(1), period_discount(2), period_discount(3);
--    (예: 3months가 라이브면 0.10 / 0.11 / 0.12 가 나온다 → 8/12주가 이미 노출 중일 수 있음)
-- 2) 위 create or replace 실행.
-- 3) 적용 후(after) 재확인 — 0.10 / 0.12 / 0.15 가 나와야 한다:
--      select period_discount(1), period_discount(2), period_discount(3);
-- 4) 각 기간 1건씩 테스트 주문으로 total_amount 육안 검증.
--    예) milk-750(정가 12,000) × 3병, 배송비 4,000/주:
--        4주(10%):  병당 10,800 → 회당 32,400 → total_amount 145,600
--        8주(12%):  병당 10,560 → 회당 31,680 → total_amount 285,440
--        12주(15%): 병당 10,200 → 회당 30,600 → total_amount 415,200
```

- [ ] **Step 3: 파일 정확성 자체 점검**

Run: `grep -n "when 1 then 0.10\|when 2 then 0.12\|when 3 then 0.15\|else null" supabase/migration-period-weeks-tiers.sql`
Expected: 4줄 모두 매칭(요율 3줄 + else null 1줄).

- [ ] **Step 4: 커밋**

```bash
git add supabase/migration-period-weeks-tiers.sql
git commit -m "feat: 정기구독 기간 할인 4/8/12주(10/12/15%) 서버 마이그레이션"
```

---

### Task 2: `lib/products.ts` 상수·타입 확장 + 단위테스트 (TDD)

**Files:**
- Create: `lib/products.test.ts`
- Modify: `lib/products.ts` (lines 54–58 타입/라벨, 66–68 할인, 신규 `PERIOD_BADGE`, 주석 41–42·53·65·89)

> `discountForPeriod`(line 69–71)와 `periodWeeks`(line 61–63)는 **변경 불필요** — 맵 확장만으로 1/2/3 자동 동작. `BASE_DISCOUNT = PERIOD_DISCOUNT[1] = 0.10`(line 90)도 그대로 둔다(상품카드 회원가 표기 기준은 4주 10% 유지).

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/products.test.ts` 신규:
```ts
import { describe, it, expect } from "vitest";
import {
  SUB_PERIODS,
  PERIOD_LABEL,
  PERIOD_DISCOUNT,
  PERIOD_BADGE,
  discountForPeriod,
  periodWeeks,
  subscribePrice,
  subShippingFee,
  BASE_DISCOUNT,
  type SubPeriod,
} from "./products";

describe("정기구독 기간 옵션", () => {
  it("SUB_PERIODS는 1·2·3(4/8/12주) 세 단계", () => {
    expect(SUB_PERIODS).toEqual([1, 2, 3]);
  });

  it("PERIOD_LABEL은 주 단위 라벨", () => {
    expect(PERIOD_LABEL[1]).toBe("4주");
    expect(PERIOD_LABEL[2]).toBe("8주");
    expect(PERIOD_LABEL[3]).toBe("12주");
  });

  it("PERIOD_DISCOUNT는 10/12/15%", () => {
    expect(PERIOD_DISCOUNT[1]).toBe(0.10);
    expect(PERIOD_DISCOUNT[2]).toBe(0.12);
    expect(PERIOD_DISCOUNT[3]).toBe(0.15);
  });

  it("PERIOD_BADGE: 8주=인기, 12주=최대 할인, 4주=없음", () => {
    expect(PERIOD_BADGE[2]).toBe("인기");
    expect(PERIOD_BADGE[3]).toBe("최대 할인");
    expect(PERIOD_BADGE[1]).toBeUndefined();
  });

  it("BASE_DISCOUNT은 4주(10%) 유지 — 상품카드 회원가 기준 불변", () => {
    expect(BASE_DISCOUNT).toBe(0.10);
  });
});

describe("discountForPeriod / periodWeeks", () => {
  it("discountForPeriod는 모든 기간에서 number 반환(undefined 아님)", () => {
    // PERIOD_DISCOUNT가 Partial로 새면 런타임에만 드러나므로 가드.
    for (const m of SUB_PERIODS) {
      expect(typeof discountForPeriod(m)).toBe("number");
    }
  });

  it("discountForPeriod 값", () => {
    expect(discountForPeriod(1)).toBe(0.10);
    expect(discountForPeriod(2)).toBe(0.12);
    expect(discountForPeriod(3)).toBe(0.15);
  });

  it("periodWeeks = 개월*4", () => {
    expect(periodWeeks(1)).toBe(4);
    expect(periodWeeks(2)).toBe(8);
    expect(periodWeeks(3)).toBe(12);
  });
});

describe("기간별 입금 합계 산식(대표 1품목: 정가 12,000 × 3병)", () => {
  // 서버 create_subscription_order와 동일 산식을 클라 순수함수로 재현:
  //   병당 = round(price*(1-rate)/10)*10, 회당 = 병당*qty,
  //   total = 회당*weeks + (4000*weeks).  배송비는 항상 자부담.
  // 주의: 클라(Math.round, 반올림)와 서버(Postgres round, 5는 올림)는 .5 경계에서만 갈린다.
  //   아래 3개 정가는 경계에 닿지 않아 일치. 금액 권위는 어디까지나 서버다(이 테스트는 재현일 뿐).
  const price = 12000;
  const qty = 3;
  const periodTotal = (m: SubPeriod): number => {
    const rate = discountForPeriod(m);
    const perDelivery = subscribePrice(price, rate) * qty;
    const weeks = periodWeeks(m);
    const ship = subShippingFee(perDelivery) * weeks;
    return perDelivery * weeks + ship;
  };

  it("4주(10%) → 145,600", () => {
    expect(periodTotal(1)).toBe(145600);
  });
  it("8주(12%) → 285,440", () => {
    expect(periodTotal(2)).toBe(285440);
  });
  it("12주(15%) → 415,200", () => {
    expect(periodTotal(3)).toBe(415200);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types \
  --experimental-loader /tmp/vrun/loader.mjs /tmp/vrun/run.mjs lib/products.test.ts
```
Expected: FAIL — `PERIOD_BADGE`가 export 안 됨(LOAD ERROR) 또는 `SUB_PERIODS`가 `[1]`이라 다수 FAIL.

- [ ] **Step 3: `lib/products.ts` 상수·타입 최소 수정**

(a) lines 54–58 교체:
```ts
// 구독 기간(개월): 1=4주, 2=8주, 3=12주. 사용자에겐 '주'로 노출(PERIOD_LABEL).
export type SubPeriod = 1 | 2 | 3;
export const SUB_PERIODS: SubPeriod[] = [1, 2, 3];
export const PERIOD_LABEL: Record<SubPeriod, string> = {
  1: "4주",
  2: "8주",
  3: "12주",
};
```

(b) lines 66–68(`PERIOD_DISCOUNT` 객체) 교체:
```ts
export const PERIOD_DISCOUNT: Record<SubPeriod, number> = {
  1: 0.10,
  2: 0.12,
  3: 0.15,
};
```

(c) `PERIOD_DISCOUNT` 선언 바로 아래(현재 `discountForPeriod` 위)에 신규 상수 추가:
```ts
// 기간 배지(표시용). 8주=인기 기본, 12주=최대 할인. 4주는 배지 없음.
export const PERIOD_BADGE: Partial<Record<SubPeriod, string>> = {
  2: "인기",
  3: "최대 할인",
};
```

(d) 사실과 어긋나는 주석만 외과적으로 갱신:
   - line 65 `// 기간(개월) → 할인율. 1개월 고정, 회원 할인 10%.`
     → `// 기간(개월) → 할인율. 4주 10% / 8주 12% / 12주 15%.`
   - line 89 `// 회원 기본 할인(1개월 고정 10%). 가격 표기/병당 회원가 계산의 기본값.`
     → `// 회원 기본 할인(4주 기준 10%). 상품카드 병당 회원가 표기의 기본값.`
   - lines 41–42 정책 주석의 `구독 기간은 1개월 고정.` / `회원 할인율 10%.` 부분
     → `구독 기간은 4·8·12주 중 선택.` / `회원 할인율 10/12/15%.`로 갱신(나머지 문장은 그대로).

> 그 외 줄(특히 `discountForPeriod`, `periodWeeks`, `BASE_DISCOUNT`, `subscribePrice`)은 건드리지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types \
  --experimental-loader /tmp/vrun/loader.mjs /tmp/vrun/run.mjs lib/products.test.ts
```
Expected: `FAIL: 0`, products 테스트 전부 PASS, `FILES_RUN: 1/1`.

- [ ] **Step 5: 커밋**

```bash
git add lib/products.ts lib/products.test.ts
git commit -m "feat: 기간 옵션 4/8/12주 상수·라벨·할인·배지 + 단위테스트"
```

---

### Task 3: `lib/cart.tsx` 기본 기간 8주

**Files:**
- Modify: `lib/cart.tsx:76`

> cart.tsx는 JSX라 커스텀 러너가 stub으로 대체한다(직접 단위테스트 대상 아님). 검증은 tsc + 수동 확인. 변경은 1줄.

- [ ] **Step 1: 기본 period 초기값 변경**

`lib/cart.tsx` line 76:
```ts
  const [period, setPeriodState] = useState<SubPeriod>(1);
```
→
```ts
  const [period, setPeriodState] = useState<SubPeriod>(2); // 8주 기본('인기')
```

> localStorage rehydration(line 80–92)은 그대로 둔다 — 재방문자는 이전 선택을 복원한다(spec §6, 의도된 동작). 신규/캐시 비운 방문자만 8주를 본다.

- [ ] **Step 2: 타입 게이트**

Run: `/opt/homebrew/opt/node@22/bin/npx tsc --noEmit`
Expected: exit 0(오류 없음).

- [ ] **Step 3: 커밋**

```bash
git add lib/cart.tsx
git commit -m "feat: 장바구니 기본 구독 기간 8주"
```

---

### Task 4: `components/PurchasePanel.tsx` 기본 선택 8주 + 기간 배지

**Files:**
- Modify: `components/PurchasePanel.tsx` (import line 5–17, useState line 27, 배지 렌더 line 116–137)

> 이 컴포넌트는 `SUB_PERIODS.map`으로 이미 N개 옵션을 자동 렌더한다. 기본 선택값과 배지 span만 추가한다.

- [ ] **Step 1: `PERIOD_BADGE` import 추가**

line 5–17 import 블록의 `PERIOD_LABEL,` 다음 줄에 추가:
```ts
  PERIOD_BADGE,
```

- [ ] **Step 2: 기본 선택 8주로 변경**

line 27:
```ts
  const [period, setPeriodLocal] = useState<SubPeriod>(1);
```
→
```ts
  const [period, setPeriodLocal] = useState<SubPeriod>(2); // 8주 기본('인기')
```

- [ ] **Step 3: 배지 span 렌더 추가**

line 130 `<span>{PERIOD_LABEL[m]}</span>` 바로 위에, 배지가 있으면 표시:
```tsx
              {PERIOD_BADGE[m] && (
                <span className="mb-0.5 rounded-full bg-gold/15 px-1.5 py-px text-[9px] font-medium leading-tight text-gold-deep">
                  {PERIOD_BADGE[m]}
                </span>
              )}
              <span>{PERIOD_LABEL[m]}</span>
```

> 기존 button은 `flex-col items-center`라 배지가 라벨 위에 쌓인다. 나머지(rate/weeks/periodTotal 계산)는 무변경 — 3개 옵션 자동 확장.

- [ ] **Step 4: 타입 게이트**

Run: `/opt/homebrew/opt/node@22/bin/npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: 커밋**

```bash
git add components/PurchasePanel.tsx
git commit -m "feat: 구매패널 기본 8주 선택 + 기간 배지(인기/최대 할인)"
```

---

### Task 5: 전체 게이트 (tsc + 전체 테스트)

**Files:** 없음(검증만).

- [ ] **Step 1: 타입 게이트 — 전체**

Run: `/opt/homebrew/opt/node@22/bin/npx tsc --noEmit`
Expected: exit 0, 출력 없음.

- [ ] **Step 2: 전체 테스트 스위트**

Run:
```bash
/opt/homebrew/opt/node@22/bin/node --experimental-strip-types \
  --experimental-loader /tmp/vrun/loader.mjs /tmp/vrun/run.mjs \
  $(find lib -name '*.test.ts' | sort)
```
Expected: `FAIL: 0`, `FILES_RUN: N/N`(전 파일 로드, 직전 79 + products 신규 테스트 = 증가). LOAD ERRORS 없음.

- [ ] **Step 3: 변경 요약 점검(외과적 변경 확인)**

Run: `git diff main --stat`
Expected: 5개 파일만 변경 —
`supabase/migration-period-weeks-tiers.sql`(신규), `lib/products.ts`, `lib/products.test.ts`(신규), `lib/cart.tsx`, `components/PurchasePanel.tsx`. **그 외 파일 변경 없음.** `public/brand/*.jpg` 2개는 untracked로 그대로(커밋 금지).

> 푸시는 **사장님 지시가 있을 때만**. 이 plan은 로컬 커밋까지만 한다.

---

## 완료 기준 (Evidence-Based)

- [ ] `tsc --noEmit` exit 0 (node@22).
- [ ] 커스텀 러너 `FAIL: 0` + 전 파일 로드 + products 신규 테스트 PASS.
- [ ] `git diff main --stat`이 정확히 5개 파일만 표시.
- [ ] 마이그레이션 파일에 before/after 검증 쿼리 + 기간별 예상 total_amount(145,600 / 285,440 / 415,200) 주석 포함.
- [ ] (사장님 수동) 마이그레이션 적용 후 각 기간 1건 테스트주문 total_amount 육안 일치.
