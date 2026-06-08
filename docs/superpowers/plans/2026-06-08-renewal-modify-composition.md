# 구독 연장 시 구성·요일·회차 변경 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구독 연장(renewal) 시 회원이 상품 구성·배송 요일·회차수(4/8/12주)를 바꿔서 연장할 수 있게 한다. 변경은 다음 블록부터만 적용.

**Architecture:** "블록(block)" 모델 — 연장주문이 자기 `order_items`를 갖고 `renews_slot_id`로 슬롯에 체인된다. 순수 TS 타임라인(`lib/subscription-timeline.ts`)이 "발송일→활성 블록(품목·요일)"을 산출하고, 배송 명단·생산수요·환불이 이를 공유한다. order_items 없는 레거시 블록은 직전 블록을 상속해 기존 동작과 100% 동일.

**Tech Stack:** Next.js(app router), TypeScript, Supabase(PostgreSQL plpgsql RPC), vitest, zod.

**Spec:** `docs/superpowers/specs/2026-06-08-renewal-modify-composition-design.md`

**기존 인프라 재사용(중요):** 할인은 `lib/products.ts` 의 `PERIOD_DISCOUNT`/`discountForPeriod(SubPeriod)`(4주10/8주12/12주15%)와 SQL 라이브 `period_discount(p_period)`. 회당 단가는 `subscribePrice(price, rate)`(=`Math.round(price×(1−rate)/10)×10`, SQL 반올림과 동일). 회차↔주는 `periodWeeks`. 날짜↔회차는 `lib/subscription-schedule.ts` 의 `computeSchedule`.

**선행 작업 (구현 전 1회):**
- `git pull origin main` 후 작업 브랜치/워크트리에서 진행.
- DB 자동 적용 금지 — SQL은 파일로만 작성, 사장님이 Supabase SQL Editor에서 직접 적용.
- 각 청크 끝/머지 전 `npx tsc --noEmit` 와 `npm test` 통과 확인.

---

## Chunk 1: 순수 TS 타임라인 모듈

새 파일 `lib/subscription-timeline.ts` + `lib/subscription-timeline.test.ts`. 외부 의존은 `./subscription-schedule`, `./cart`(타입), `./products`(할인/단가)만. 모든 함수 순수·불변.

### 데이터 모델

```typescript
// lib/subscription-timeline.ts
import type { DeliveryDay } from "./cart";
import { computeSchedule, type SubInput } from "./subscription-schedule";

export type BlockItem = {
  productName: string;
  volume: string;
  qty: number;
  unitPrice: number; // 할인 적용된 회당 단가 (order_items.unit_price)
};

// 원자료 블록 — order(block_weeks) + 자기 order_items 에서 구성.
export type RawBlock = {
  orderId: string;
  weeks: number;                   // block_weeks
  shippingPerWeek: number;         // 회당 배송비 (order.shipping_fee / weeks)
  items: BlockItem[];              // 빈 배열이면 직전 블록 상속(레거시)
};

// 상속·누적회차 적용된 유효 블록.
export type ResolvedBlock = {
  orderId: string;        // 발송 attribution 용 — 이 블록의 items 가 가진 실제 order_id
  deliveryDay: DeliveryDay;
  items: BlockItem[];
  shippingPerWeek: number;
  fromRound: number;      // 1-base 포함
  toRound: number;        // 1-base 미포함 (= fromRound + weeks)
};
```

### Task 1.1: `normalizeBlocks` — 상속 + 회차 구간

**Files:**
- Create: `lib/subscription-timeline.ts`
- Test: `lib/subscription-timeline.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// lib/subscription-timeline.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBlocks, type RawBlock } from "./subscription-timeline";

const chicken = { productName: "닭가슴살", volume: "200g", qty: 2, unitPrice: 10800 };
const beef    = { productName: "소고기",   volume: "150g", qty: 1, unitPrice: 30600 };

function raw(over: Partial<RawBlock>): RawBlock {
  return { orderId: "o0", weeks: 4, shippingPerWeek: 4000, items: [chicken], ...over };
}

describe("normalizeBlocks", () => {
  it("회차 구간을 누적으로 매긴다", () => {
    const r = normalizeBlocks(
      [raw({ orderId: "o0", weeks: 4 }), raw({ orderId: "o1", weeks: 8, items: [beef] })],
      "tue"
    );
    expect(r.map((b) => [b.fromRound, b.toRound])).toEqual([[1, 5], [5, 13]]);
    expect(r[1].deliveryDay).toBe("tue"); // o1 자기 요일은 인자로 받은 day 매핑(아래 설명)
  });

  it("items 빈 블록은 직전 블록의 품목·요일·배송비를 상속한다", () => {
    const r = normalizeBlocks(
      [raw({ orderId: "o0", weeks: 4, items: [chicken] }),
       raw({ orderId: "o1", weeks: 4, items: [] })], // 레거시 연장
      "tue"
    );
    expect(r[1].items).toEqual([chicken]);
    expect(r[1].deliveryDay).toBe("tue");
    expect(r[1].orderId).toBe("o0"); // 상속이면 발송 attribution 은 원본(품목 보유) 블록
  });
});
```

> 설명: `RawBlock` 자체엔 요일이 없다(요일은 호출부가 order_items.delivery_day에서 뽑아 블록별로 넣음). 단순화를 위해 `normalizeBlocks(blocks, fallbackDay)`는 블록별 요일을 별도 인자로 받지 않고, 호출부가 `RawBlock`에 `deliveryDay`를 미리 채워 넣는 형태로 바꾼다 — 아래 Step 3에서 `RawBlock`에 `deliveryDay: DeliveryDay | null` 필드를 추가하고, fallbackDay 인자는 제거한다. (테스트도 그에 맞춰 수정한다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- subscription-timeline`
Expected: FAIL (`normalizeBlocks` not exported)

- [ ] **Step 3: 최소 구현 + RawBlock에 deliveryDay 추가**

```typescript
export type RawBlock = {
  orderId: string;
  weeks: number;
  deliveryDay: DeliveryDay | null; // 자기 items 있을 때만; null이면 상속
  shippingPerWeek: number;
  items: BlockItem[];
};

export function normalizeBlocks(blocks: RawBlock[]): ResolvedBlock[] {
  const out: ResolvedBlock[] = [];
  let cursor = 1;
  let inherited: Pick<ResolvedBlock, "orderId" | "deliveryDay" | "items" | "shippingPerWeek"> | null = null;
  for (const b of blocks) {
    const hasOwn = b.items.length > 0 && b.deliveryDay != null;
    const src = hasOwn
      ? { orderId: b.orderId, deliveryDay: b.deliveryDay as DeliveryDay, items: b.items, shippingPerWeek: b.shippingPerWeek }
      : inherited;
    if (!src) {
      // 첫 블록이 비어있는 비정상 입력 — 빈 구간으로 스킵하되 회차는 전진.
      cursor += Math.max(0, b.weeks);
      continue;
    }
    out.push({ ...src, fromRound: cursor, toRound: cursor + Math.max(0, b.weeks) });
    cursor += Math.max(0, b.weeks);
    inherited = src;
  }
  return out;
}
```

> 위 Step 1 테스트의 `normalizeBlocks(..., "tue")` 2번째 인자와 `deliveryDay` 미지정 부분을 `RawBlock.deliveryDay`로 옮겨 수정한다. (`raw()` 헬퍼에 `deliveryDay: "tue"` 기본값 추가, 레거시 블록은 `deliveryDay: null, items: []`.)

- [ ] **Step 4: 테스트 통과 확인** — Run: `npm test -- subscription-timeline` → PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/subscription-timeline.ts lib/subscription-timeline.test.ts
git commit -m "feat: subscription-timeline normalizeBlocks (상속+회차구간)"
```

### Task 1.2: `activeBlockForRound` / `activeBlockForDate`

**Files:** Modify `lib/subscription-timeline.ts`, `lib/subscription-timeline.test.ts`

- [ ] **Step 1: 실패 테스트**

```typescript
import { activeBlockForRound, activeBlockForDate } from "./subscription-timeline";

describe("activeBlockForRound", () => {
  const blocks = normalizeBlocks([
    { orderId: "o0", weeks: 4, deliveryDay: "tue", shippingPerWeek: 4000, items: [chicken] },
    { orderId: "o1", weeks: 4, deliveryDay: "wed", shippingPerWeek: 4000, items: [beef] },
  ]);
  it("4회차는 블록0(화·닭)", () => {
    expect(activeBlockForRound(blocks, 4)?.orderId).toBe("o0");
    expect(activeBlockForRound(blocks, 4)?.deliveryDay).toBe("tue");
  });
  it("5회차는 블록1(수·소고기)", () => {
    expect(activeBlockForRound(blocks, 5)?.deliveryDay).toBe("wed");
    expect(activeBlockForRound(blocks, 5)?.items).toEqual([beef]);
  });
  it("범위 밖 회차는 null", () => {
    expect(activeBlockForRound(blocks, 9)).toBeNull();
    expect(activeBlockForRound(blocks, 0)).toBeNull();
  });
});

describe("activeBlockForDate", () => {
  // 시작 2026-01-06(화), 블록0 4회 화, 블록1 4회 수. 정지 없음.
  const input = {
    startedAt: "2026-01-06",
    paused: false, pausedAt: null, pausedDays: 0,
    blocks: [
      { orderId: "o0", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000, items: [chicken] },
      { orderId: "o1", weeks: 4, deliveryDay: "wed" as const, shippingPerWeek: 4000, items: [beef] },
    ],
  };
  it("5회차 날짜(블록1 구간)면 블록1을 돌려준다", () => {
    // 5회차 예정일 = 시작 + 4주 = 2026-02-03 부근 — 그 날짜로 평가
    const b = activeBlockForDate(input, "2026-02-03");
    expect(b?.orderId).toBe("o1");
  });
  it("소진 후(총 8회 지난) 날짜는 null", () => {
    expect(activeBlockForDate(input, "2026-04-01")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- subscription-timeline` → FAIL

- [ ] **Step 3: 구현**

```typescript
export function activeBlockForRound(blocks: ResolvedBlock[], round: number): ResolvedBlock | null {
  if (round < 1) return null;
  return blocks.find((b) => round >= b.fromRound && round < b.toRound) ?? null;
}

export type TimelineInput = SubInput extends infer _ ? {
  startedAt: string | null;
  paused: boolean; pausedAt: string | null; pausedDays: number;
  blocks: RawBlock[];
} : never;

export function totalWeeks(blocks: RawBlock[]): number {
  return blocks.reduce((s, b) => s + Math.max(0, b.weeks), 0);
}

export function activeBlockForDate(
  input: TimelineInput,
  dateISO: string
): ResolvedBlock | null {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    { startedAt: input.startedAt, totalWeeks: total, paused: input.paused, pausedAt: input.pausedAt, pausedDays: input.pausedDays },
    new Date(`${dateISO}T00:00:00`)
  );
  if (!sched.started || input.paused) return null;
  if (sched.endDate != null && dateISO > sched.endDate) return null; // 소진
  if (input.startedAt != null && dateISO < input.startedAt) return null; // 시작 전
  const round = Math.max(1, sched.delivered);
  return activeBlockForRound(resolved, round);
}
```

> 주의: `round = max(1, delivered)` 는 `dispatch-schedule.ts:42` 와 동일 정의. 소진/시작전/정지 제외 조건도 `dispatchScheduleForSlot` 와 동일하게 맞춘다(SSOT 일치).

- [ ] **Step 4: 통과 확인** — Run: `npm test -- subscription-timeline` → PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat: timeline activeBlockForRound/ForDate (computeSchedule 재사용)"`

### Task 1.3: `renewalQuote` (견적·단가) — 기존 `subscribePrice` 재사용

**Files:** Modify `lib/subscription-timeline.ts`, test

- [ ] **Step 1: 실패 테스트**

```typescript
import { renewalQuote } from "./subscription-timeline";
import { discountForPeriod } from "./products";

describe("renewalQuote", () => {
  // milk-750 정가 12,000 × 3, 8주(period 2 → 12%): 병당 10,560 → 회당 31,680
  const items = [{ listPrice: 12000, qty: 3 }];
  it("8주(period2) 견적", () => {
    const q = renewalQuote(items, 2, 4000);
    expect(q.unitTotalPerDelivery).toBe(31680);   // 10560*3
    expect(q.weeks).toBe(8);
    expect(q.shipping).toBe(32000);                // 4000*8
    expect(q.total).toBe(31680 * 8 + 32000);       // 285,440
    expect(q.belowMin).toBe(false);
  });
  it("회당 25,000 미만이면 belowMin true", () => {
    expect(renewalQuote([{ listPrice: 12000, qty: 1 }], 1, 4000).belowMin).toBe(true);
  });
  it("허용 안 된 기간은 throw", () => {
    expect(() => renewalQuote(items, 5 as never, 4000)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현**

```typescript
import { discountForPeriod, periodWeeks, subscribePrice, MIN_ORDER_KRW, type SubPeriod } from "./products";

export type QuoteItem = { listPrice: number; qty: number };
export type RenewalQuote = {
  weeks: number;
  unitTotalPerDelivery: number; // 할인 적용 회당 상품 합계
  listTotalPerDelivery: number; // 정가 회당 합계(참고)
  shipping: number;
  total: number;
  belowMin: boolean;            // 회당 < MIN_ORDER_KRW
};

export function renewalQuote(items: QuoteItem[], period: SubPeriod, shippingPerWeek: number): RenewalQuote {
  const rate = discountForPeriod(period);
  if (rate == null) throw new Error(`허용되지 않은 구독 기간: ${period}`);
  const weeks = periodWeeks(period);
  let unit = 0, list = 0;
  for (const it of items) {
    if (it.qty <= 0) continue;
    unit += subscribePrice(it.listPrice, rate) * it.qty;
    list += it.listPrice * it.qty;
  }
  const shipping = shippingPerWeek * weeks;
  return {
    weeks,
    unitTotalPerDelivery: unit,
    listTotalPerDelivery: list,
    shipping,
    total: unit * weeks + shipping,
    belowMin: unit < MIN_ORDER_KRW,
  };
}
```

- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 커밋** — `git commit -am "feat: renewalQuote (기존 subscribePrice/discountForPeriod 재사용)"`

### Task 1.4: `refundByBlocks` (블록별 환불) — computeSchedule 회차 SSOT

**Files:** Modify `lib/subscription-timeline.ts`, test

- [ ] **Step 1: 실패 테스트**

```typescript
import { refundByBlocks } from "./subscription-timeline";

describe("refundByBlocks", () => {
  // 시작 2026-01-06(화), 블록0 4회(회당상품 21600+배송4000), 블록1 4회(회당상품 30600+배송4000)
  const input = {
    startedAt: "2026-01-06", paused: false, pausedAt: null, pausedDays: 0,
    blocks: [
      { orderId: "o0", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000,
        items: [{ productName: "닭", volume: "200g", qty: 2, unitPrice: 10800 }] },
      { orderId: "o1", weeks: 4, deliveryDay: "tue" as const, shippingPerWeek: 4000,
        items: [{ productName: "소", volume: "150g", qty: 1, unitPrice: 30600 }] },
    ],
  };
  it("2회 배송 시점 환불 = 남은 회차의 소속 블록 단가 합", () => {
    // 2회 배송 완료(블록0 2회 남음 @ 21600+4000=25600, 블록1 4회 @ 30600+4000=34600)
    // 남은 = 25600*2 + 34600*4 = 51,200 + 138,400 = 189,600
    expect(refundByBlocks(input, "2026-01-13")).toBe(189600);
  });
  it("단일 블록·extended0이면 기존 평균식과 동일", () => {
    const single = { ...input, blocks: [input.blocks[0]] };
    // 1회 배송 후 남은 3회 @ 25600 = 76,800
    expect(refundByBlocks(single, "2026-01-06")).toBe(76800);
  });
});
```

- [ ] **Step 2: 실패 확인** → FAIL

- [ ] **Step 3: 구현**

```typescript
export function refundByBlocks(input: TimelineInput, asOfDateISO: string): number {
  const resolved = normalizeBlocks(input.blocks);
  const total = totalWeeks(input.blocks);
  const sched = computeSchedule(
    { startedAt: input.startedAt, totalWeeks: total, paused: input.paused, pausedAt: input.pausedAt, pausedDays: input.pausedDays },
    new Date(`${asOfDateISO}T00:00:00`)
  );
  const delivered = input.startedAt ? sched.delivered : 0;
  let refund = 0;
  for (let round = delivered + 1; round <= total; round++) {
    const b = activeBlockForRound(resolved, round);
    if (!b) continue;
    const perDelivery = b.items.reduce((s, it) => s + it.unitPrice * it.qty, 0) + b.shippingPerWeek;
    refund += perDelivery;
  }
  return refund;
}
```

- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 불변식 테스트 추가** — `totalWeeks(blocks) === block_weeks + extended_weeks` 를 보장하는 헬퍼 테스트(원주문 weeks + 연장 weeks 합).
- [ ] **Step 6: 커밋** — `git commit -am "feat: refundByBlocks (블록별 단가, computeSchedule 회차 SSOT)"`

---

## Chunk 2: SQL 마이그레이션 (자동 적용 금지 — 파일만)

새 파일 `supabase/migration-renewal-modify.sql` + `supabase/schema.sql` 동기 갱신. **DB에 직접 적용하지 않는다.** 라이브 본문 출처는 `schema.sql` + `migration-special-delivery-renewal.sql`(특수배송 분기).

### Task 2.1: 신 `request_renewal(bigint, jsonb, int, text)`

**Files:** Create `supabase/migration-renewal-modify.sql`; Modify `supabase/schema.sql`(request_renewal 교체)

- [ ] **Step 1: 마이그레이션 파일 헤더 + 선행 확인 주석**

```sql
-- 구독 연장 시 구성·요일·회차 변경.
--   선행 확인: select period_discount(1),period_discount(2),period_discount(3);  → 0.10/0.12/0.15
--   선행 의존: is_special_delivery_postcode(text) 존재(migration-special-delivery-region*.sql)
-- 적용: Supabase SQL Editor 에서 순서대로 실행. 멱등(create or replace / drop if exists).
drop function if exists public.request_renewal(bigint);
```

- [ ] **Step 2: 신 `request_renewal` 본문 작성**

```sql
create or replace function public.request_renewal(
  p_slot_id      bigint,
  p_items        jsonb,   -- [{product_id, qty}, ...]
  p_period       int,     -- 1|2|3 (= 4/8/12주)
  p_delivery_day text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_slot record; v_src record;
  v_rate numeric; v_weeks int;
  v_item jsonb; v_pid text; v_qty int;
  v_price int; v_name text; v_volume text; v_unit int;
  v_per_delivery int := 0; v_per_list int := 0;
  v_taken int; v_shipping int; v_total int;
  v_order_id uuid; v_order_no text;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select * into v_slot from public.subscription_slots
    where id = p_slot_id and user_id = v_uid and status = '활성' for update;
  if not found then raise exception '연장할 수 있는 활성 구독이 아닙니다.'; end if;
  if exists (select 1 from public.orders where renews_slot_id = p_slot_id and status = '입금대기') then
    raise exception '이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.';
  end if;

  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;
  if p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '연장할 품목이 없습니다.'; end if;

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  -- 금액 재계산(서버 권위)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id'; v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list := v_per_list + v_price * v_qty;
  end loop;
  if v_per_delivery < 25000 then raise exception '회당 최소 상품 금액은 25,000원입니다.'; end if;

  -- 요일 변경 사전 검사(권고; 권위 검사는 confirm)
  if p_delivery_day <> v_slot.delivery_day then
    if exists (select 1 from public.subscription_slots
                where user_id = v_uid and delivery_day = p_delivery_day and status <> '해지') then
      raise exception '이미 그 요일에 구독이 있어 요일을 변경할 수 없습니다.';
    end if;
    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = p_delivery_day;
    if v_taken >= 100 then raise exception '선택한 요일이 마감되어 변경할 수 없습니다.'; end if;
  end if;

  v_shipping := (case when public.is_special_delivery_postcode(v_src.ship_postcode)
                 then 5000 else 4000 end) * v_weeks;
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, renews_slot_id
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  -- ★ 신규: 연장주문 자기 order_items (새 구성·요일)
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id'; v_qty := (v_item->>'qty')::int;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, p_delivery_day, v_qty, v_unit);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end; $$;
grant execute on function public.request_renewal(bigint, jsonb, int, text) to authenticated;
```

- [ ] **Step 3: schema.sql 동기** — schema.sql 의 기존 `request_renewal(bigint)` 정의 블록을 위 본문으로 교체(+ `drop function if exists public.request_renewal(bigint);` 선행).
- [ ] **Step 4: 검증(수기, DB 미적용)** — 파일 문법 육안 검토. (실 적용은 사장님; 적용 후 `select request_renewal(...)` 1건 테스트.)
- [ ] **Step 5: 커밋** — `git add supabase/migration-renewal-modify.sql supabase/schema.sql && git commit -m "feat(sql): request_renewal 구성·요일·회차 변경 + order_items 생성"`

### Task 2.2: `confirm_renewal_payment` — 좌석 이동(권위)

**Files:** Modify `supabase/migration-renewal-modify.sql`, `supabase/schema.sql`

- [ ] **Step 1: 본문 작성**

```sql
create or replace function public.confirm_renewal_payment(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_slot bigint; v_weeks int; v_day text; v_cur_day text; v_taken int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  select renews_slot_id, block_weeks into v_slot, v_weeks
    from public.orders where id = p_order_id for update;
  if v_slot is null then raise exception '연장 주문이 아닙니다.'; end if;

  -- 연장주문의 발송요일(자기 order_items, 모두 동일)
  select delivery_day into v_day from public.order_items where order_id = p_order_id limit 1;

  select delivery_day into v_cur_day from public.subscription_slots where id = v_slot for update;

  if v_day is not null and v_day <> v_cur_day then
    perform pg_advisory_xact_lock(hashtext('slot_day:' || v_day));
    if exists (select 1 from public.subscription_slots s
                where s.user_id = (select user_id from public.subscription_slots where id = v_slot)
                  and s.delivery_day = v_day and s.status <> '해지' and s.id <> v_slot) then
      raise exception '대상 요일에 이미 구독이 있어 좌석을 이동할 수 없습니다.';
    end if;
    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = v_day;
    if v_taken >= 100 then raise exception '대상 요일이 마감되어 좌석을 이동할 수 없습니다.'; end if;
    update public.subscription_slots set delivery_day = v_day where id = v_slot;
  end if;

  update public.orders set status = '입금확인' where id = p_order_id;
  update public.subscription_slots set extended_weeks = extended_weeks + v_weeks where id = v_slot;
end; $$;
grant execute on function public.confirm_renewal_payment(uuid) to authenticated;
```

- [ ] **Step 2: schema.sql 동기** (기존 confirm_renewal_payment 교체)
- [ ] **Step 3: 커밋** — `git commit -am "feat(sql): confirm_renewal_payment 좌석 이동(advisory lock 권위 검사)"`

### Task 2.3: `cancel_subscription` — 블록별 환불

**Files:** Modify `supabase/migration-renewal-modify.sql`, `supabase/schema.sql`

- [ ] **Step 1:** 기존 `cancel_subscription` 의 환불 산식 부분만 외과적으로 교체. 평균식(`round(total/weeks)*remaining`) 대신, 슬롯의 **블록 체인(원주문 + 입금확인 연장주문 order_items)** 으로 남은 회차를 회차별 단가 합산. plpgsql에서:
  - 원주문 + `renews_slot_id = slot` AND status in ('입금확인','배송준비','배송중','배송완료') 인 주문들을 `id` 순으로 모아 각 블록의 `(회당상품합 from order_items, shipping_fee/block_weeks, block_weeks)` 산출.
  - order_items 없는 블록은 직전 블록 단가 상속.
  - `computeSchedule` 동일 규칙으로 delivered 계산(기존 cancel_subscription의 `v_delivered` 로직 재사용 — `least(total, elapsed/7+1)`), `total = Σ block_weeks`.
  - 남은 회차(delivered+1..total) 각각 소속 블록 단가 합 → `v_refund`.

- [ ] **Step 2: 회귀 핀 주석** — "단일 블록 AND extended_weeks=0 → 기존 결과와 동일; 연장 이력 있으면 상향 정정(의도)" 명시.
- [ ] **Step 3: schema.sql 동기**
- [ ] **Step 4: 커밋** — `git commit -am "fix(sql): cancel_subscription 블록별 환불(연장 과소환불 정정)"`

> 검증(사장님 적용 후): 연장 이력 없는 구독 해지 → 기존과 동일 환불액. 연장(요일/구성 변경) 구독 해지 → 남은 회차 블록 단가 정밀 합산 확인.

---

## Chunk 3: 배송 명단/생산수요 블록 인지 리팩터

목표: 한 슬롯이 여러 블록(items 보유)을 가질 때, 그 발송일에 **활성 블록 1개**만 발송/집계. 레거시는 오늘과 동일.

### Task 3.1: roster용 슬롯-블록 빌더 (순수)

**Files:** Modify `lib/subscription-timeline.ts` (or new `lib/slot-blocks.ts`), test

- [ ] **Step 1: 실패 테스트** — `buildRawBlocks(originalOrder, renewalOrders, itemsByOrder)` 가 `RawBlock[]` 를 `id` 순으로, items 있는 주문은 자기 요일/품목, 없으면 `deliveryDay:null/items:[]` 로 만들고 `shippingPerWeek = shipping_fee/block_weeks` 로 채우는지.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 순수 함수. 입력은 최소 필드 제네릭(roster 패턴과 동일).
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋**

### Task 3.2: `delivery-roster.ts` 활성 블록 게이팅

**Files:** Modify `lib/delivery-roster.ts`, `lib/delivery-roster.test.ts`(있으면), `app/admin/page.tsx`(slotByOrder 재키잉)

- [ ] **Step 1: 실패 테스트(회귀+신규)** — (a) 레거시 슬롯(연장 items 없음): 기존 명단과 동일. (b) 다블록 슬롯: 블록1 구간 날짜엔 블록1 items만, 블록0 items는 미발송(이중발송 0).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**
  - `app/admin/page.tsx` 의 `slotByOrder` 빌드를 **연장주문 order_id 도 같은 슬롯**으로 매핑하도록 확장(현재 `s.order_id` 만 → `renews_slot_id` 연장주문 id 포함).
  - `buildRosterForDate` 에서 슬롯별 `activeBlockForDate(dateISO)` 의 `orderId` 와 일치하는 order_items 만 발송. (활성 블록 없음 → 그 슬롯 해당일 미발송.)
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -am "fix: 배송 명단 활성 블록만 발송(이중발송 방지)"`

### Task 3.3: 생산수요 매트릭스 활성 블록 게이팅

**Files:** Modify `app/admin/page.tsx`(matrix 집계, ~430-446)

- [ ] **Step 1:** matrix 집계가 모든 order_items 전수합 → 슬롯별 "그 주 활성 블록"만 계상하도록 게이팅(roster와 동일 SSOT). 단품(`#10`) 제외 가드는 유지.
- [ ] **Step 2:** 가능한 한 순수 함수로 추출해 단위 테스트(이중계상 0, 레거시 동일).
- [ ] **Step 3: 커밋** — `git commit -am "fix: 생산수요 매트릭스 활성 블록만 계상(이중계상 방지)"`

---

## Chunk 4: 클라이언트 & UI

### Task 4.1: `lib/subscriptions.ts` requestRenewal 시그니처 + 환불 미리보기 통일

**Files:** Modify `lib/subscriptions.ts`, `lib/subscriptions.test.ts`

- [ ] **Step 1: 실패 테스트** — `requestRenewal` 이 zod 검증된 `{ items, period, deliveryDay }` 로 RPC를 호출(인자 매핑). `refundAmount` 미리보기가 `refundByBlocks` 와 동일 결과(블록 입력).
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현**

```typescript
import { z } from "zod";
import type { SubPeriod } from "./products";

const RenewalArgs = z.object({
  items: z.array(z.object({ product_id: z.string().min(1), qty: z.number().int().positive() })).min(1),
  period: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  deliveryDay: z.enum(["mon","tue","wed","thu","fri"]),
});

export async function requestRenewal(
  slotId: number,
  args: { items: { product_id: string; qty: number }[]; period: SubPeriod; deliveryDay: DeliveryDay }
): Promise<RenewalResult> {
  const v = RenewalArgs.parse(args);
  const { data, error } = await getSupabase().rpc("request_renewal", {
    p_slot_id: slotId, p_items: v.items, p_period: v.period, p_delivery_day: v.deliveryDay,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as { order_id?: string; order_no?: string; total?: number };
  return { orderId: r.order_id ?? "", orderNo: r.order_no ?? "", total: r.total ?? 0 };
}
```

- [ ] **Step 4: refundAmount 통일** — `refundAmount` 가 `refundByBlocks`(블록 입력)로 위임하도록 교체. `getMySubscriptions`/`toMySubscriptions` 가 환불 미리보기에 필요한 블록 데이터(원주문+연장주문 order_items)를 함께 로드. 단일 블록이면 기존과 동일(테스트로 고정).
- [ ] **Step 5: 통과** → PASS
- [ ] **Step 6: 커밋** — `git commit -am "feat: requestRenewal(items/period/day) + 환불 미리보기 블록 통일"`

### Task 4.2: 연장 신청 폼 UI

**Files:** Modify `app/account/page.tsx`

- [ ] **Step 1:** "구독 연장 (재입금)" 버튼 클릭 시 인라인 폼 펼침(기존 입금 안내 박스 흐름 유지). 구성요소:
  - 품목 편집: 현재 슬롯 활성 블록 구성 프리필, `product_catalog` 에서 추가/수량/제거.
  - 회차수: `SUB_PERIODS`/`PERIOD_LABEL`/`PERIOD_BADGE` 재사용(신규 구독 폼과 동일 UI).
  - 요일: 현재 요일 프리필 + `getDayCounts()` 로 요일별 잔여석 표시, 만석 요일 비활성. 본인이 이미 가진 요일도 비활성.
  - 실시간 견적: `renewalQuote` 로 회당·할인·배송비·총액, `belowMin` 이면 제출 비활성 + 25,000 안내.
- [ ] **Step 2:** 제출 → `requestRenewal(slotId, { items, period, deliveryDay })` → 기존 입금 안내(`RenewalInfo`) 박스 표시 + `notify({ kind: "renewal_guide" })`.
- [ ] **Step 3:** "그대로 연장"(프리필 그대로 제출)도 자연 지원되는지 수동 확인.
- [ ] **Step 4: tsc** — `npx tsc --noEmit` → 0 errors.
- [ ] **Step 5: 커밋** — `git commit -am "feat: 연장 신청 폼(품목·요일·회차 변경, 실시간 견적)"`

---

## 최종 검증 (머지 전)

- [ ] `npm test` 전체 통과 (timeline/subscriptions/roster 회귀 포함)
- [ ] `npx tsc --noEmit` 0 errors
- [ ] 환불 Red-Green: 단일 블록 동일 / 연장 정정 (수정 되돌려 실패 확인)
- [ ] 수동 체크리스트: 동일연장 / 품목변경 / 요일변경(좌석 이동·만석 거절) / 8·12주 할인·총액 / 환불 정밀도
- [ ] SQL은 파일만 — 사장님 적용 절차 주석 확인(period_discount 선행 확인, is_special_delivery_postcode 의존)
- [ ] PUBLIC repo: SQL/코드에 시크릿 없음 확인
- [ ] 커밋 메시지 conventional, 푸시 전 `git pull --rebase`

## 범위 밖 (명시)
배송지 변경, 요일별 분리배송, 현재 회차 즉시 변경(차액/부분환불), 자동 대기열 전환, 시간 인지형 정원, 카드 기간 라벨 읽기 경로 변경.
