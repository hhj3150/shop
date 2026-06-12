# 구독 주차별 공휴일 배송일 보정 Implementation Plan (v2)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 중 정기구독의 모든 회차에 대해, 주간 배송일이 주말·공휴일이면 다음 영업일로 미룬다(날짜만 이동, 회차수·금액·환불 불변).

**Architecture:** ① `lib/ship-date.ts` 에 **요일 기준** 시프트 판정 `deliveryDayHitsDate(deliveryDay, dateISO)` 를 추가(슬롯 앵커가 아니라 품목/블록의 배송요일에만 의존 — 멀티요일 슬롯 누락 방지). ② `lib/subscription-schedule.ts` 의 회차 날짜 계산에 `advanceToBusinessDay` 를 적용해 `endDate`/`delivered`/표시 다음배송일을 시프트 반영(게이팅의 소진·pastEnd 정합). ③ `lib/delivery-roster.ts` 의 정기 포함 판정을 `it.delivery_day === weekday` 에서 `deliveryDayHitsDate(it.delivery_day, dateISO).hits` 로 바꿔 **요일경로+first-ship 시프트를 단일 패스로 통합**하되, 활성블록 게이팅·폴백·보수적 포함은 그대로 보존.

**Tech Stack:** TypeScript, vitest. SQL 변경 없음.

**Spec:** `docs/superpowers/specs/2026-06-13-subscription-weekly-holiday-design.md`

**핵심 불변식(절대):** 오늘 명단에 포함되는 주문은 변경 후에도 포함된다 — 날짜만 이동, 누락 금지. `deliveryDayHitsDate` 는 슬롯 없이 요일만으로 판정하므로 슬롯 유무와 무관하게 공휴일엔 제외·시프트일엔 포함된다(불변식 보장).

**리뷰 교훈(중요):** 한 슬롯의 블록 체인은 서로 다른 배송요일을 가질 수 있다(원주문 월 + 연장 화). 시프트를 슬롯 앵커 cadence로 계산하면 다른 요일 블록의 회차를 놓쳐 누락된다. 그래서 시프트는 **요일 기준**으로만 판정한다.

**테스트:** `npx vitest run <파일>` · 타입체크 `npx tsc --noEmit`

---

## File Structure

- Modify `lib/ship-date.ts` — `advanceToBusinessDay` export + `deliveryDayHitsDate` 신설.
- Modify `lib/subscription-schedule.ts` — `deliveryDate` 전 회차 시프트.
- Modify `lib/delivery-roster.ts` — 정기 포함 판정 `deliveryDayHitsDate` 단일 패스 통합, `weekday` 파라미터 제거.
- Modify 호출부 — `buildRosterForDate` 의 `weekday` 인자 제거(grep 로 전수: 최소 `app/admin/page.tsx`, `lib/admin-assistant/queries.ts`).
- Tests: `lib/ship-date.test.ts`, `lib/subscription-schedule.test.ts`, `lib/delivery-roster.test.ts`(+기존 회귀).

---

## Chunk 1: 요일 시프트 헬퍼 + 스케줄 시프트

### Task 1: `advanceToBusinessDay` export + `deliveryDayHitsDate`

**Files:** Modify `lib/ship-date.ts`, Test `lib/ship-date.test.ts`(신규 또는 기존에 추가)

배경: `lib/ship-date.ts` 에 `advanceToBusinessDay(d: Date): void`(비export, Date 변이, 토·일·`isHolidayISO` 전진), `toISODate(d)`, `SUB_DAY_NUM = {mon:1..fri:5}`, `import { isHolidayISO } from "./holidays"` 가 있다.

- [ ] **Step 1: 실패 테스트 작성** — `lib/ship-date.test.ts` 에 추가(기존 보존)

```ts
import { deliveryDayHitsDate } from "./ship-date";

describe("deliveryDayHitsDate", () => {
  // 2026-05-05(화) 어린이날 공휴일. 화요일 배송 기준.
  it("평소 당일(평일·해당요일)은 hits true, shifted false", () => {
    // 2026-04-28 화(평일)
    expect(deliveryDayHitsDate("tue", "2026-04-28")).toEqual({ hits: true, shifted: false });
  });
  it("공휴일 당일은 hits false(시프트로 오늘 아님)", () => {
    expect(deliveryDayHitsDate("tue", "2026-05-05")).toEqual({ hits: false, shifted: false });
  });
  it("시프트 도착일(다음 영업일)은 hits true, shifted true", () => {
    // 화(05-05 공휴일) → 수(05-06)
    expect(deliveryDayHitsDate("tue", "2026-05-06")).toEqual({ hits: true, shifted: true });
  });
  it("그 요일이 아니고 시프트도 아니면 hits false", () => {
    // 수요일인데 화 배송이고 화(05-05)가 공휴일이 아니라면? → 평소엔 수에 화배송 안 옴
    expect(deliveryDayHitsDate("tue", "2026-04-29").hits).toBe(false); // 04-28 화 평일 → 전진 no-op → 04-29 아님
  });
  it("주말 날짜는 항상 hits false(전진 결과는 평일)", () => {
    expect(deliveryDayHitsDate("fri", "2026-05-09").hits).toBe(false); // 토
  });
});
```
> 날짜·공휴일은 구현 전 `lib/holidays.ts` KR_HOLIDAYS 로 확인(2026-05-05 어린이날=화). 다르면 실제 공휴일로 맞춘다(캘린더가 권위).

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/ship-date.test.ts` → FAIL(`deliveryDayHitsDate` 없음).

- [ ] **Step 3: 구현** — `lib/ship-date.ts`
  1. `function advanceToBusinessDay` → `export function advanceToBusinessDay` (본문 불변).
  2. 함수 추가(파일 내 `SUB_DAY_NUM` 정의 이후):

```ts
// 주어진 배송요일(deliveryDay)의 그 주 배송일이 dateISO 인지 — 공휴일/주말이면 다음 영업일로 시프트.
//   슬롯 앵커가 아니라 '요일'만 보므로 멀티요일 슬롯(원주문/연장 요일 상이)도 정확하다.
//   ① 평소: dateISO 가 그 요일·평일 → {hits:true, shifted:false}
//   ② 공휴일 당일: 그 요일이지만 공휴일 → 전진 결과가 미래 → {hits:false}
//   ③ 시프트 도착일: 그 요일이 아니지만 직전 그 요일이 공휴일이라 다음 영업일이 dateISO → {hits:true, shifted:true}
//   ④ 주말 dateISO: 전진 결과는 평일뿐 → hits:false
export function deliveryDayHitsDate(
  deliveryDay: string,
  dateISO: string
): { hits: boolean; shifted: boolean } {
  const target = SUB_DAY_NUM[deliveryDay];
  if (!target) return { hits: false, shifted: false };
  const cand = new Date(`${dateISO}T00:00:00`);
  let i = 0;
  while (cand.getDay() !== target && i < 7) {
    cand.setDate(cand.getDate() - 1);
    i++;
  }
  if (cand.getDay() !== target) return { hits: false, shifted: false };
  const candISO = toISODate(cand);
  const shiftedDate = new Date(cand);
  advanceToBusinessDay(shiftedDate);
  const hits = toISODate(shiftedDate) === dateISO;
  return { hits, shifted: hits && candISO !== dateISO };
}
```
> `SUB_DAY_NUM` 이 `Record<string, number>` 가 아니면 인덱싱 타입 맞춤(`SUB_DAY_NUM[deliveryDay as keyof typeof SUB_DAY_NUM]` 등) — 기존 정의 확인 후 맞출 것.

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/ship-date.test.ts` → PASS.

- [ ] **Step 5: 회귀** — `npx vitest run lib/ship-date && npx tsc --noEmit` → PASS / 0 errors.

- [ ] **Step 6: Commit**
```bash
git add lib/ship-date.ts lib/ship-date.test.ts
git commit -m "feat: 요일 기준 공휴일 시프트 판정 deliveryDayHitsDate + advanceToBusinessDay export"
```

---

### Task 2: 스케줄 전 회차 공휴일 시프트(날짜만)

**Files:** Modify `lib/subscription-schedule.ts`(`deliveryDate` ~75-78), Test `lib/subscription-schedule.test.ts`

배경: `deliveryDate(k)` = k===1 ? `addDays(firstBase, 정지일)` : `addDays(anchor, (k-1)*7 + 정지일)`. `addDays` 는 새 Date 반환 → 그 위에 `advanceToBusinessDay`(변이) 적용해도 입력 불변. 목적: `endDate`/`delivered`/표시용 `nextDate` 가 시프트 반영 → 로스터 게이팅(소진·pastEnd)이 시프트된 마지막 회차일을 오제외하지 않음, 계정 페이지 다음배송일 정확.

- [ ] **Step 1: 실패 테스트 작성** — `lib/subscription-schedule.test.ts` 추가(기존 보존)

```ts
import { computeSchedule } from "./subscription-schedule";

describe("주차별 공휴일 시프트", () => {
  // 앵커 2026-04-28(화), 2회차 원래 2026-05-05(화·어린이날)→05-06(수).
  const base = { startedAt: "2026-04-28", firstShipDate: null, paused: false, pausedAt: null, pausedDays: 0 };

  it("공휴일에 걸린 2회차는 다음 영업일로 시프트(endDate 반영)", () => {
    const s = computeSchedule({ ...base, totalWeeks: 2 }, new Date("2026-05-06T00:00:00"));
    expect(s.endDate).toBe("2026-05-06");
    expect(s.delivered).toBe(2);
  });
  it("공휴일 당일(05-05)엔 2회차 미완료, nextDate=05-06", () => {
    const s = computeSchedule({ ...base, totalWeeks: 2 }, new Date("2026-05-05T00:00:00"));
    expect(s.delivered).toBe(1);
    expect(s.nextDate).toBe("2026-05-06");
  });
  it("k=1 firstShipDate idempotent — 보정값 재전진 no-op", () => {
    const inp = { startedAt: "2026-05-05", firstShipDate: "2026-05-06", paused: false, pausedAt: null, pausedDays: 0, totalWeeks: 1 };
    expect(computeSchedule(inp, new Date("2026-05-06T00:00:00")).endDate).toBe("2026-05-06");
  });
  it("최장 연휴 클러스터에서 단조·무충돌", () => {
    // 앵커 2027-02-01(월). 2회차 원래 2027-02-08(월·설연휴)→다음 영업일. 3회차 2027-02-15(월 평일).
    const inp = { startedAt: "2027-02-01", firstShipDate: null, paused: false, pausedAt: null, pausedDays: 0, totalWeeks: 3 };
    const s = computeSchedule(inp, new Date("2027-02-20T00:00:00"));
    expect(s.endDate).toBe("2027-02-15"); // 3회차 평일 그대로
    expect(s.delivered).toBe(3);
  });
});
```
> 날짜·공휴일은 `lib/holidays.ts` 로 확인 후 확정. 2027 설 연휴(2/6~2/9)·대체공휴일 포함 — 2회차 시프트 도착일은 실제 캘린더로 계산해 기대값 작성.

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/subscription-schedule.test.ts` → FAIL(시프트 미반영).

- [ ] **Step 3: 구현** — `lib/subscription-schedule.ts`
  1. 상단 import: `import { advanceToBusinessDay } from "./ship-date";`
  2. `deliveryDate`(75-78행) 교체:
```ts
  // k번째 배송 예정일 + 누적 정지일, 주말·공휴일이면 다음 영업일로 시프트(날짜만).
  //   1회차 firstBase 는 #73 과 동일 술어로 이미 보정된 값(또는 평일 앵커) → 재전진 no-op.
  const deliveryDate = (k: number) => {
    const d =
      k === 1
        ? addDays(firstBase, totalPausedDays)
        : addDays(anchor, (k - 1) * 7 + totalPausedDays);
    advanceToBusinessDay(d); // addDays 는 새 Date → 변이 안전
    return d;
  };
```

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/subscription-schedule.test.ts` → PASS.

- [ ] **Step 5: 회귀** — `npx vitest run lib/ && npx tsc --noEmit` → 전체 PASS / 0 errors. computeSchedule 소비자(dispatch-schedule·subscription-timeline·renewal-form·customer-360) 기존 테스트가 시프트로 깨지면 **의도된 동작인지 사람에게 보고**(임의 수정 금지). 단 멀티요일 슬롯의 회차 카운트는 앵커요일 근사(기존과 동일 근사) — 새 회귀가 아니면 진행.

- [ ] **Step 6: Commit**
```bash
git add lib/subscription-schedule.ts lib/subscription-schedule.test.ts
git commit -m "feat: 구독 전 회차 공휴일 시프트(endDate·delivered 반영, 날짜만)"
```

---

## Chunk 2: 로스터 단일 패스 통합

### Task 3: 정기 포함 판정 `deliveryDayHitsDate` 통합 + `weekday` 제거

**Files:** Modify `lib/delivery-roster.ts`(정기 섹션 ~82-164), 호출부, Test `lib/delivery-roster.test.ts`

설계: 정기 포함을 **단일 패스**로. 날짜 일치 기준만 `it.delivery_day === weekday` → `deliveryDayHitsDate(it.delivery_day, dateISO).hits`. **활성블록 게이팅(110-126)·폴백 excluded(128-138)·보수적 포함·단품/방문수령/해지/정지 제외·정렬·반환형 verbatim 보존.** 기존 first-ship 가드(100행)·별도 시프트 블록(142-164)·`alreadyIncluded` 제거(단일 패스가 흡수, 이중 불가). `weekday` 파라미터 제거.

- [ ] **Step 1: 실패 테스트 작성** — `lib/delivery-roster.test.ts` 신규 describe(기존 전부 보존). 기존 테스트의 `buildRosterForDate` 호출에서 `weekday` 인자를 제거해야 하므로(시그니처 변경), 기존 호출부도 함께 수정됨을 전제로 작성. 신규:

```ts
describe("주차별 공휴일 시프트(2회차+)", () => {
  const A = "2026-04-28";   // 1회차(화)
  const HOL = "2026-05-05"; // 2회차 원래(화·어린이날)
  const SH = "2026-05-06";  // 시프트(수)
  const items = () => [{ order_id: "o1", product_name: "우유", volume: "750mL", delivery_day: "tue" as const, qty: 1 }];
  const order = { id: "o1", order_type: "구독", block_weeks: 4, ship_date: null, ship_name: "김", delivery_method: "택배" };
  const slotInfo = { status: "활성", started_at: A, first_ship_date: null, paused: false, paused_at: null, paused_days: 0, extended_weeks: 0 };
  const call = (dateISO: string, withSlot = true) =>
    buildRosterForDate({
      dateISO, items: items(),
      orderById: new Map([["o1", order]]),
      slotByOrder: withSlot ? new Map([["o1", slotInfo]]) : new Map(),
      confirmedOrderIds: new Set(["o1"]), pausedOrderIds: new Set(),
    });

  it("공휴일 당일(화)엔 제외", () => expect(call(HOL).length).toBe(0));
  it("시프트된 다음 영업일(수)에 포함", () => {
    const e = call(SH); expect(e.length).toBe(1); expect(e[0].order.id).toBe("o1");
  });
  it("평소 회차(화)는 그대로 포함", () => expect(call(A).length).toBe(1));
  it("슬롯 없어도 공휴일 제외+시프트일 포함(불변식)", () => {
    expect(call(HOL, false).length).toBe(0);
    expect(call(SH, false).length).toBe(1); // 누락 금지
  });
});
```
> `buildRosterForDate` 호출에 `weekday` 가 빠졌다(시그니처에서 제거 예정). 연장(활성블록) 시프트 케이스 1건도 추가 — 블록맵(`blocksBySlot`/`slotIdByOrder`/`slotById`) 구성은 기존 활성블록 테스트(같은 파일) 패턴을 복사해 작성하고, 블록의 `deliveryDay` 가 공휴일에 걸리는 회차가 시프트 도착일에 포함되는지 검증. (멀티요일 수렴 엣지: 2027-02-10 처럼 월·화 두 회차가 같은 다음 영업일로 수렴해도 `active.orderId===orderId` 게이팅이 1블록만 고르는지 1건 확인.)

> ⚠ **[필수] 기존 first-ship 테스트 본문 재작성(블로커):** `lib/delivery-roster.test.ts` 의 describe
> "첫배송 공휴일 시프트(first_ship_date)"(약 169-236행, 5개 it)는 **가짜 공휴일**에 의존한다 —
> `ANCHOR="2026-06-01"` 을 공휴일로 가정하지만 2026-06-01 은 **실제 평일 월요일**(KR_HOLIDAYS 미포함).
> 구버전은 로스터가 `first_ship_date===dateISO` 데이터만 봤기에 통과했으나, 신버전은 **실제 공휴일
> 캘린더** 기반(`deliveryDayHitsDate`)이라 이 픽스처는 무효가 된다(06-01 → hits:true 로 포함돼 "당일 제외"
> 기대가 깨짐). **프로덕션 동작은 보존**된다(실 first_ship_date 는 SQL 이 실제 kr_holidays 로 계산 →
> 실제 공휴일에 대응). 따라서 이 5개 테스트는 시그니처(weekday 제거)뿐 아니라 **본문을 실제 공휴일
> 날짜로 재작성**한다: 예 `ANCHOR="2026-05-05"`(화·어린이날, 실제 공휴일), `delivery_day:"tue"`,
> `first_ship_date="2026-05-06"`(다음 영업일). 그러면 05-05(앵커 공휴일)=제외, 05-06(시프트)=포함,
> 해지/정지 변형도 05-06 에서 status 로 제외됨을 검증(원래 의도 복원). 이 재작성은 본 Task 의 일부다.

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/delivery-roster.test.ts` → FAIL(공휴일 당일 여전히 포함 / 시그니처 불일치).

- [ ] **Step 3: 구현** — `lib/delivery-roster.ts`
  1. import 추가: `import { deliveryDayHitsDate } from "./ship-date";`
  2. `buildRosterForDate` params 에서 `weekday: DeliveryDay | null;` **제거**(타입·구조분해 둘 다).
  3. 정기 섹션(82-164) 교체 — `if (weekday) { ... }` 래퍼 제거, byOrder 그룹화를 `deliveryDayHitsDate.hits` 로, 게이팅 루프는 **기존 93-139 코드 그대로**(단 100행 first-ship 가드만 삭제), 별도 시프트 블록(142-164)·alreadyIncluded 삭제:
```ts
  // ── 정기: 이 날짜(공휴일 시프트 반영)에 배송되는 회차분 ──
  const byOrder = new Map<string, I[]>();
  for (const it of items) {
    if (!confirmedOrderIds.has(it.order_id)) continue;
    if (pausedOrderIds.has(it.order_id)) continue;
    if (!deliveryDayHitsDate(it.delivery_day, dateISO).hits) continue; // 평소 당일 또는 공휴일 시프트 도착일
    const arr = byOrder.get(it.order_id) ?? [];
    arr.push(it);
    byOrder.set(it.order_id, arr);
  }
  for (const [orderId, its] of byOrder) {
    const order = orderById.get(orderId);
    if (!order || order.order_type === "단품" || order.delivery_method === "방문수령") continue;

    // (기존 활성블록 게이팅 — 110-126 그대로 유지)
    const slotId = slotIdByOrder?.get(orderId);
    const slotForBlocks = slotId != null ? slotById?.get(slotId) : undefined;
    const blocks = slotId != null ? blocksBySlot?.get(slotId) : undefined;
    if (slotForBlocks && blocks && blocks.length > 0) {
      if (slotForBlocks.status === "해지" || slotForBlocks.paused) continue;
      const active = activeBlockForDate(
        { startedAt: slotForBlocks.started_at, paused: slotForBlocks.paused, pausedAt: slotForBlocks.paused_at, pausedDays: slotForBlocks.paused_days, blocks },
        dateISO
      );
      if (!active || active.orderId !== orderId) continue;
      entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
      continue;
    }

    // (기존 폴백 — 128-138 그대로 유지: 슬롯 없으면 보수적 포함)
    const fallbackSlot = slotByOrder.get(orderId);
    if (
      fallbackSlot &&
      dispatchScheduleForSlot(fallbackSlot, order.block_weeks ?? 0, dateISO).excluded
    ) {
      continue;
    }
    entries.push({ order, items: its, sig: compositionSignature(its), kind: "정기" });
  }
```
  4. 단품 섹션(166~) 이하 **변경 없음**.

- [ ] **Step 4: 호출부 갱신** — `grep -rn "buildRosterForDate" app/ lib/ components/` 로 전수 확인 후 각 호출에서 `weekday: …` 인자 제거(예 `app/admin/page.tsx`, `lib/admin-assistant/queries.ts:155`). `weekdayOf(d)` 가 그 인자에만 쓰였다면 해당 계산도 제거(미사용 변수 금지). `npx tsc --noEmit` 로 누락 호출부 적발.

- [ ] **Step 5: 통과 확인** — `npx vitest run lib/delivery-roster.test.ts` → PASS. 기존 테스트 수정 2종을 같은 커밋에:
  (a) 모든 `buildRosterForDate` 호출에서 `weekday` 인자 제거(시그니처 정합).
  (b) **first-ship describe(169-236) 5개 it 본문을 실제 공휴일 날짜로 재작성**(위 Step 1 ⚠ 지침대로 —
     가짜 공휴일 06-01 → 실제 어린이날 05-05 화 등). 활성블록·제외·단품 테스트는 (a)만 적용해 green 유지.
  ※ 만약 본문 재작성으로도 의도 동작이 안 나오면(예 게이팅 회귀) 임의 수정 말고 사람에게 보고.

- [ ] **Step 6: 전체 회귀** — `npx vitest run && npx tsc --noEmit` → 전체 PASS / 0 errors. 특히 멀티요일 활성블록 테스트(원주문 월 + 연장 화 등)가 비공휴일 날짜에서 그대로 포함되는지(누락 회귀 없음) 확인.

- [ ] **Step 7: Commit**
```bash
git add lib/delivery-roster.ts lib/delivery-roster.test.ts app/admin/page.tsx lib/admin-assistant/queries.ts
git commit -m "feat: 로스터 정기 포함을 요일 기준 공휴일 시프트로 통합(weekday 파라미터 제거)"
```

---

## 완료 기준 (Evidence-Based)
- [ ] `npx vitest run` 전체 PASS(신규 deliveryDayHitsDate/스케줄 시프트/로스터 시프트 + 기존 회귀)
- [ ] `npx tsc --noEmit` 0 errors
- [ ] `npm run build` 성공
- [ ] 불변식 점검: 슬롯 없는 주문도 공휴일 제외+시프트일 포함(테스트 증명). 멀티요일 활성블록 회차 누락 없음.
- [ ] PR: spec/plan 링크 + 테스트 결과. **SQL 마이그레이션 없음** 명시.

## 미적용/후속
- 환불 SQL(`cancel_subscription` 경과일/7+1) 불변(결정 A) — 공휴일주 해지 시 환불 회차 1주 미만 어긋날 수 있음(문서화).
- 멀티요일 슬롯의 회차 카운트는 앵커요일 근사(기존과 동일) — 본 작업 범위 밖.
- `kr_holidays`(SQL)·`lib/holidays.ts` 연1회 동반 갱신 기존 규칙 유지.
