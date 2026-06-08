# 구독 연장 시 구성·요일·회차 변경 (Renewal Modify)

- 작성일: 2026-06-08
- 상태: 설계 승인 대기 (브레인스토밍 + spec 리뷰 1회 반영 완료)
- 관련: `supabase/migration-special-delivery-renewal.sql`(= 라이브 `request_renewal` 본문),
  `supabase/migration-renewal-retention.sql`, `lib/subscriptions.ts`,
  `lib/delivery-roster.ts`, `lib/dispatch-schedule.ts`, `lib/subscription-schedule.ts`,
  `app/account/page.tsx`, `app/admin/page.tsx`

## 1. 목적 (결론 우선)

구독 **연장(renewal)** 시 회원이 (1) 상품 구성(품목·용량·수량), (2) 배송 요일,
(3) 회차수(배송 기간)를 **바꿔서** 연장할 수 있게 한다.

현재 `request_renewal`은 원주문 품목을 그대로 복제해 1개월(4회)·10%로만 재계산하므로
연장 시 구성·요일·기간을 바꿀 수 없다.

## 2. 확정된 범위

| 항목 | 결정 | 근거 |
|---|---|---|
| 적용 시점 | **다음 회차(블록)부터만** | 현재 진행 회차 불변 → 차액·환불 불필요 |
| 요일 변경 | **포함, 단 대상 요일에 정원 있을 때만** | 만석/본인 슬롯 충돌 시 거절 |
| 회차수 | **4 / 8 / 12회 중 선택** (= `SubPeriod` 1/2/3, 기존 인프라 재사용) | 한 번에 선결제 |
| 할인율 | **4주 10% / 8주 12% / 12주 15%** (= 라이브 `period_discount`/`PERIOD_DISCOUNT` 그대로) | 신규 주문과 동일 정책 |
| 차액/환불(신규) | **없음** (다음 회차부터만이라 현재 회차와 금액 분리) | — |
| 배송지 변경 | **범위 밖** (원주문 승계) | 프로필 편집은 별도 기능 |
| 요일별 분리배송 | **범위 밖** (연장 블록은 단일 요일) | YAGNI |

## 3. 핵심 설계 — "블록(block)" 모델

### 3.1 블록 = renews_slot_id 로 체인된 orders 행

- **블록0** = 슬롯의 원주문 (`subscription_slots.order_id`)
- **블록 k** = **입금확인된** 연장주문 (`orders.renews_slot_id = slot.id`)
- 큐 순서 = 확정 블록들의 `created_at` 오름차순 (= 시간순; `id` 는 random uuid 라 비단조 →
  `created_at, id` 로 정렬). "입금대기 연장 1건만 허용" 제약이 동시 입금대기 충돌을 막아
  created_at 이 곧 진짜 블록 순서가 된다.
- 각 블록이 갖는 것: `block_weeks`(회차), 자기 `order_items`(품목·요일·단가)
- 슬롯 총회차 = Σ 블록.block_weeks

### 3.2 불변식 (INVARIANT) — 단일 진실 + 캐시

- `subscription_slots.extended_weeks` 는 **확정 연장 블록 weeks 합의 캐시**다.
  **불변식**: `extended_weeks == Σ(입금확인 연장블록.block_weeks)`,
  따라서 `슬롯 총회차 == original.block_weeks + extended_weeks == Σ(모든 블록.weeks)`.
- **유일 작성자**: `confirm_renewal_payment` 만 `extended_weeks` 를 증가시킨다(오늘과 동일).
  타임라인 모듈은 `Σ block.weeks` 를 **읽기 전용 도출**로만 쓰고, 두 값의 일치를 테스트로 고정.
- 이 캐시 덕에 리텐션 RPC(`renewal_reminder_targets`, 만료일 =
  `started_at + (block_weeks + extended_weeks)*7 + paused_days`), `dispatch-schedule.ts`,
  `toMySubscriptions` **세 소비자 모두 무변경**으로 동작한다.

### 3.3 스키마 변경 — 최소

1. **새 테이블/새 컬럼 없음.** 연장주문이 이제 자기 `order_items` 를 갖는다
   (현재 라이브 `request_renewal` 은 `orders` 만 INSERT, `order_items` 미생성 — 확인됨).
2. `extended_weeks` 유지(§3.2).
3. 블록 순서는 `created_at, id` 순서로 도출(추가 컬럼 불필요; `orders.created_at` 기존 컬럼 사용).

### 3.4 하위호환 규칙 (결정적)

> `order_items` 가 **없는** 블록(= 기존 구식 연장주문)은 **직전 블록의 구성·요일을 상속**한다.

→ 기존 확정 연장들은 원주문 품목을 옛 요일로 계속 발송 = **발송 명단은 오늘과 100% 동일**.
   데이터 백필 불필요. (환불은 §7.3 참고 — 일부 레거시는 의도된 정정이 있음.)

## 4. 순수 TS 타임라인 로직 (TDD 핵심)

신규 파일 `lib/subscription-timeline.ts`. 모든 함수 순수·불변(spread).

### 4.1 입력 타입

```typescript
type BlockItem = { productName: string; volume: string; qty: number; unitPrice: number };
type Block = {
  orderId: string;
  weeks: number;                       // block_weeks
  deliveryDay: DeliveryDay | null;     // 자기 items 있을 때만, 없으면 상속
  items: BlockItem[];                  // 빈 배열이면 직전 블록 상속
};
type TimelineInput = {
  startedAt: string | null;
  paused: boolean; pausedAt: string | null; pausedDays: number;
  blocks: Block[];                     // id 순서(블록0 먼저)
};
```

### 4.2 함수 (각각 TDD)

| 함수 | 책임 |
|---|---|
| `normalizeBlocks(blocks)` | 상속 적용 → 유효 블록 + 누적 회차 경계 `[fromRound, toRound)` (1-base) |
| `activeBlockForRound(blocks, round)` | n회차에 발송할 블록(품목·요일·orderId) |
| `activeBlockForDate(input, dateISO)` | 발송일 → 회차 산출 → 활성 블록. 정지/시작전/소진이면 null |
| `renewalQuote(items, period, shippingPerWeek)` | 회당합·리스트합·배송비·총액 + 최소 25,000 검증. 단가는 기존 `subscribePrice(price, discountForPeriod(period))` 재사용 |
| `refundByBlocks(input, asOfDateISO)` | 남은(미배송) 회차를 **회차별 소속 블록 단가**로 합산 |

**기존 인프라 재사용(신규 함수 없음):** 할인율은 `lib/products.ts` 의
`PERIOD_DISCOUNT`/`discountForPeriod(SubPeriod)` (4주 10%/8주 12%/12주 15%), 회당 단가는
`subscribePrice(price, rate)` (= `Math.round(price×(1−rate)/10)×10`, SQL 반올림과 동일),
회차수↔주 변환은 `periodWeeks(SubPeriod)`. 신규 SQL 할인 함수를 만들지 않고 라이브
`period_discount(p_period)` (1/2/3 → 10/12/15%, `migration-period-weeks-tiers.sql` 적용본)을 쓴다.

### 4.3 기존 로직 재사용 (정확한 시그니처)

회차↔날짜 변환은 기존 `lib/subscription-schedule.ts` 의
`computeSchedule(input: SubInput, now)` 를 사용한다. `SubInput =
{ startedAt, totalWeeks, paused, pausedAt, pausedDays }` 이므로 타임라인은
**`totalWeeks = Σ block.weeks`** 를 계산해 넘긴다. 반환의 `delivered`/`endDate` 에서
**회차(round) = `max(1, delivered)`** (기존 `dispatch-schedule.ts` 와 동일)로 도출한다.

### 4.4 대표 테스트 시나리오 (RED 먼저)

- 블록0(4회 닭가슴살·화) + 블록1(4회 소고기·수) → 5회차는 수요일·소고기, 4회차는 화요일·닭
- 빈 블록(레거시) → 원구성 상속, 옛 요일 유지 (오늘과 동일)
- 8회 블록 소진 후 발송일 → null(회차소진)
- 정지 7일 → 전체 꼬리 시프트, 블록 경계도 동일 시프트
- 불변식: `Σ block.weeks == block_weeks + extended_weeks`
- 환불: 블록0 단가 ≠ 블록1 단가일 때 회차별 정밀 합산 (Red-Green)

## 5. 할인 — 기존 함수 재사용 (신규 함수 없음)

라이브 `period_discount(p_months)` 는 이미 `migration-period-weeks-tiers.sql` 로
**1→0.10, 2→0.12, 3→0.15** 다(= 4/8/12주). 연장은 신규 주문(`create_subscription_order`)과
**같은 `period_discount(p_period)` 를 호출**한다. TS 미러는 `lib/products.ts` 의
`PERIOD_DISCOUNT`/`discountForPeriod`. → 새 SQL/TS 할인 함수 불필요(중복 제거, DRY).

## 6. RPC 변경

### 6.1 `request_renewal` 시그니처 확장

```sql
request_renewal(
  p_slot_id      bigint,
  p_items        jsonb,   -- [{product_id, qty}, ...] (요일은 블록 단위 단일)
  p_period       int,     -- 1 | 2 | 3 (= 4/8/12주, create_subscription_order 와 동일 의미)
  p_delivery_day text     -- 'mon'..'fri'
)
```

로직 (`create_subscription_order` 와 정합):
1. 인증 → 슬롯 `for update` 잠금(본인·활성), 입금대기 연장 중복 거절
2. `v_rate := period_discount(p_period)` → null 이면 거절(허용 기간 외). `v_weeks := p_period*4`
3. `p_delivery_day in ('mon'..'fri')`, items 비어있음/수량>0/판매중(`product_catalog.active`) 검증
4. 회당합·리스트합 계산 → **회당 < 25,000 거절** (신규 주문과 동일 floor — §6.5)
5. **요일 변경 시(p_delivery_day ≠ slot.delivery_day) 사전 검사(권고)**:
   대상 요일에 본인 비해지 슬롯 존재 시 거절(유니크 충돌),
   대상 요일 `count(*) filter (where status in ('신청','활성'))` ≥ 100 이면 거절("정원 있을 때만")
6. **배송비(특수배송지역 보존)**:
   `(case when public.is_special_delivery_postcode(v_src.ship_postcode) then 5000 else 4000 end) * v_weeks`.
   총액 = 회당합 × v_weeks + 배송비. (배송지=원주문 승계)
7. orders INSERT (`renews_slot_id`=슬롯, `block_weeks`=v_weeks, `period_months`=p_period,
   배송지=원주문 승계, depositor 등 승계)
8. **order_items INSERT** (각 품목 delivery_day=p_delivery_day, unit_price=할인단가) ← 신규 핵심
9. 반환 `{order_id, order_no, total}`

### 6.2 `confirm_renewal_payment` 보강 (시그니처 `(p_order_id uuid)` 불변)

관리자 클라이언트(`app/admin/page.tsx`) 무수정. 로직:
1. 관리자 권한 확인
2. 연장주문의 `block_weeks`·발송요일(자기 order_items 에서; 모두 동일 요일) 읽기, 슬롯 `for update`
3. **요일 변경분이면 좌석 이동(권위 재검사)**:
   `pg_advisory_xact_lock(hashtext('slot_day:' || 대상요일))`
   (반드시 `hashtext()` — `create_subscription_order` 와 동일 lock 네임스페이스) 아래 —
   대상 요일 `count(*) filter (where status in ('신청','활성'))` < 100 &
   본인 비해지 슬롯 충돌 없음 확인 후 `slot.delivery_day` UPDATE.
   실패 시 **예외**(주문 입금대기 유지 → 관리자 수동 처리). 입금확인 마킹 **전**에 검사.
4. `extended_weeks += block_weeks` (§3.2 유일 작성자)
5. order status = '입금확인'

### 6.3 좌석 이동의 의미 (roster 와 분리)

- **roster 발송은 `order_items.delivery_day` 기준**(슬롯 `delivery_day` 아님). 따라서 블록0
  items 는 옛 요일을, 블록1 items 는 새 요일을 그대로 갖는다 → "다음 회차부터만" 이 자연 보장.
- `slot.delivery_day` UPDATE 는 **정원 카운트·관리자 요일 그룹핑·`subscription_day_count` 뷰**
  용도일 뿐, 실제 발송 요일을 바꾸지 않는다(발송은 §7.1 활성 블록의 item 요일).

### 6.4 조기 연장 / 정원 회계 (명시적 v1 결정)

- 회원은 현재 블록 소진 전 미리 연장할 수 있다(확정됐으나 아직 시작 전인 미래 블록 가능).
- **v1 결정**: 요일 변경 시 좌석을 **입금확인 시점에 즉시 이동**(새 요일을 미리 점유, 옛 요일 카운트
  해제). 이유: "정원 있을 때만" 의도 = 회원에게 새 요일 자리를 보장.
- **알려진 한계(허용)**: 전환 구간 동안 옛 요일은 실제 발송 중이지만 카운트에선 빠져 옛 요일이
  잠시 과청약될 수 있다. 정원 100·소규모 수기운영 기준 허용. (시간 인지형 정원은 범위 밖.)
- 발송 정확성은 영향 없음(§6.3 — item 요일 기준).

### 6.5 25,000 회당 최소 — 신규 제약 주의

- 라이브 `request_renewal` 에는 25,000 floor 가 없다(신규 주문에만 존재).
- 연장에 floor 를 도입하면, **회당 25,000 미만인 레거시 구독의 "그대로 연장"이 막힐 수 있다.**
- **v1 결정**: floor 적용(신규 주문과 정합). 미만 레거시는 연장 시 품목을 늘려 25,000 이상으로
  맞추도록 UI 안내. (예외 허용은 운영 부담 → 도입 안 함.)

## 7. 배송 명단/스케줄/환불 리팩터 (블록 인지)

### 7.1 `delivery-roster.ts` — 활성 블록만 발송 (CRITICAL)

- 현재: confirmed 인 모든 order_items 를 `item.delivery_day == weekday` 로 무차별 발송, 슬롯
  총회차로만 제외 판정. 연장주문이 items 를 갖게 되면 **블록0 items 와 블록k items 가
  동시에 발송돼 이중발송**된다.
- 변경:
  1. **`slotByOrder` 재키잉**: 원주문 `order_id` 뿐 아니라 **연장주문 `order_id` 도 같은 슬롯**으로
     매핑(현재 `admin/page.tsx` 는 `s.order_id` 만 매핑 → 연장주문이 "슬롯 없음→보수적 포함"으로
     새는 버그 방지).
  2. 슬롯별로 타임라인을 구성해 그 발송일의 **활성 블록 1개**(`activeBlockForDate`)를 구한다.
  3. **그 활성 블록의 order_id 의 items 만** 발송(이미 올바른 `delivery_day` 보유). 다른 블록
     (지난/미래) items 는 그 날짜에 발송하지 않음 → 정확히 한 블록만.
- 레거시(빈 블록 상속): 활성 블록 = 블록0 이 전 구간 → 기존 명단과 동일(테스트로 고정).

### 7.2 `dispatch-schedule.ts`

- 회차/제외 판정 유지. 총회차를 `block_weeks + extended_weeks`(= Σ 블록 weeks)로 받는 현재 입력
  유지 가능(불변식 §3.2). 활성 블록 매핑은 roster/타임라인 쪽에서 수행.
- **제외(excluded) 권위 분담 명시**: 해지·정지·**회차소진/시작전**(슬롯 전체) 판정은 계속
  `dispatchScheduleForSlot` 가 권위. roster 의 활성 블록 게이팅(§7.1)은 "그 날짜에 **어느 블록**
  items 를 발송할지"만 고른다(블록 선택 ≠ 슬롯 제외). 두 층은 동일 슬롯 필드를 보므로 충돌 없음.

### 7.3 환불 — `cancel_subscription` RPC + `lib/subscriptions.ts refundAmount` (HIGH, 의도된 정정)

- **현재 실태**: `cancel_subscription` 은 환불을 **원주문 total·block_weeks 만**으로 계산
  (`round(원주문_total / 원주문_block_weeks) × remaining`) — **연장 입금분과 extended_weeks 를
  완전히 무시**한다. 따라서 연장 이력이 있는 구독은 **현재 과소환불** 상태이고, 화면 미리보기
  (`refundAmount`, 연장분 합산함)와 **서버가 이미 불일치**한다.
- **변경**: 회차별 소속 블록 단가로 남은(미배송) 회차 정밀 합산(`refundByBlocks`).
  미리보기와 서버가 **동일 로직**을 쓰도록 통일(서버 권위, C2).
- **회귀 핀(테스트로 고정)**:
  - 단일 블록 AND `extended_weeks == 0` → **현재와 동일 결과**.
  - 레거시 + 연장 이력(`extended_weeks > 0`) → **결과 변경(상향, 정정)**. 블록0 단가 상속으로
    남은 회차를 정확히 환불. 이는 의도된 정정이며 기존 클라/서버 불일치를 해소한다.
- **회차 산술 SSOT 고정**: `refundByBlocks` 의 "남은 회차" 계산은 `computeSchedule`(=
  `dispatch-schedule.ts` 가 쓰는 동일 SSOT)에서 도출해야 하며, 기존 RPC 의 인라인 산술
  (`least(total, elapsed/7 + 1)`)을 복제하지 않는다 → 신 SQL `cancel_subscription` 과 TS
  미리보기가 경계(off-by-one)에서 갈리지 않도록 동일 회차 정의를 테스트로 고정.

### 7.4 관리자 생산수요 매트릭스 (HIGH, 이중계상)

- 현재 `admin/page.tsx` 의 `matrix` 는 confirmed·비정지·비해지·비단품 order_item 의 qty 를
  요일 버킷에 **전수 합산**(단품 제외 가드 `#10` 만 있음). 연장주문이 items 를 갖게 되면 한 슬롯의
  블록0 + 모든 블록k items 가 동시에 더해져 **블록 수만큼 과대계상**된다.
- 변경: roster 와 **동일한 활성 블록 게이팅** 적용 — "그 주 활성 블록"만 1회 계상.
  `#10`(단품 누수 방어)와는 별개의 새 방어임을 명시하고 회귀 테스트(§10)에 포함.

## 8. 클라이언트 & UI

- **`lib/subscriptions.ts`**: `requestRenewal(slotId)` → `requestRenewal(slotId, { items, period, deliveryDay })`
  (`period: SubPeriod`). zod 입력 검증. 견적은 `renewalQuote`(=`subscribePrice`+`discountForPeriod`) 재사용.
- **`app/account/page.tsx`**: "구독 연장 (재입금)" 버튼 → 연장 신청 폼:
  - 품목 편집(현재 구성 프리필, 카탈로그 추가/수량/제거)
  - 회차수 선택(`SUB_PERIODS`/`PERIOD_LABEL`/`PERIOD_BADGE` 재사용 — 신규 구독 폼과 동일 UI, 할인율·총액 실시간)
  - 요일 선택(현재 요일 프리필, 요일별 잔여석 표시 — `getDayCounts` 재사용, 만석 비활성)
  - 실시간 견적(회당·할인·배송비·총액) + 최소 25,000 안내
  - 제출 → 기존 입금 안내 박스 재사용
- 변경 없이 "그대로 연장"도 프리필 그대로 제출로 가능.
- **표시 주의(LOW)**: 마이페이지 구독 카드의 기간 라벨(`periodMonths`)은 **원주문 기준**으로 읽는다
  (`toMySubscriptions`). 8/12회 연장해도 카드 라벨은 원주문 기간을 보일 수 있음 — v1 은 연장 폼/입금
  안내에서 선택 회차수를 명시하는 것으로 충분(읽기 경로 변경은 범위 밖).

## 9. 마이그레이션 & 적용 절차

- **SQL 파일만 작성**(자동 적용 안 함): `supabase/migration-renewal-modify.sql`
  - 할인 함수 신규 없음 — 라이브 `period_discount`(1/2/3→10/12/15%) 재사용
    (선행 확인: `select period_discount(1),period_discount(2),period_discount(3);` = 0.10/0.12/0.15)
  - 신 `request_renewal(bigint, jsonb, int, text)` — 구 `request_renewal(bigint)` 는 `drop function`
    (시그니처 변경). **특수배송지역 분기(§6.1-6) 반드시 보존** —
    선행 의존 `is_special_delivery_postcode` 존재 확인 주석 포함.
  - 보강 `confirm_renewal_payment` (좌석 이동 + `hashtext` lock)
  - 보강 `cancel_subscription` (블록 환불)
  - 적용 절차·검증 주석 포함(제주 5,000 / 일반 4,000 검증, 좌석 이동 검증)
- `supabase/schema.sql` 동기 갱신.
- **백필 불필요**(레거시 호환 — 발송 동일, 환불만 §7.3 의도 정정).
- 사용자(사장님)가 Supabase SQL Editor 에서 직접 적용.

## 10. 테스트 계획

- TDD(RED→GREEN): `lib/subscription-timeline.test.ts`(상속/회차구간/활성블록/환불/정지/불변식),
  `lib/subscriptions.test.ts` 확장(견적·단가·환불 통일).
- **회귀 테스트(필수)**:
  - roster: 다블록 슬롯에서 활성 블록만 발송(이중발송 0), 레거시 슬롯은 오늘과 동일 명단.
  - 매트릭스: 다블록 슬롯 생산수요 이중계상 0.
  - 환불: 단일+extended0 동일 / 레거시+연장 정정(Red-Green).
- 수동 체크리스트: 동일연장(회귀)·품목변경·요일변경(좌석 이동/만석 거절)·8/12회 할인·환불 정밀도.
- `npx tsc --noEmit` 통과 확인 후 커밋.

## 11. 위험 & 완화

| 위험 | 심각도 | 완화 |
|---|---|---|
| roster 이중발송(블록0+블록k) | CRITICAL | `slotByOrder` 재키잉 + 활성 블록 1개만 발송 + 단위/회귀 테스트 |
| 생산수요 매트릭스 이중계상 | HIGH | 활성 블록 게이팅(#10 와 별개) + 회귀 테스트 |
| 좌석 이동 lock/술어 오류 | HIGH | `hashtext` lock, `status in ('신청','활성')` 술어, 행 `for update` |
| 환불 정정이 레거시 결과 변경 | HIGH | 의도된 상향 정정 + 회귀 핀(단일+extended0 동일) + 클라/서버 통일 |
| extended_weeks 이중 진실 | MEDIUM | 불변식 + 유일 작성자(confirm) + 일치 테스트 |
| 25k floor 가 레거시 그대로연장 차단 | MEDIUM | UI 안내로 품목 보강 유도(§6.5) |
| 조기 연장 정원 phantom 점유 | MEDIUM | v1 즉시 이동(자리 보장) + 한계 문서화(§6.4) |
| 기간 라벨이 원주문 기준 표시 | LOW | 연장 폼/입금안내에서 회차수 명시(§8) |
| PUBLIC repo 시크릿 노출 | — | SQL 에 시크릿 없음, env/Netlify 분리 유지 |

## 12. 범위 밖 (명시)

- 배송지(주소) 변경, 요일별 분리배송, 현재 회차 즉시 변경(차액/부분환불),
  자동 대기열 전환, 결제수단 변경, 시간 인지형 정원, 카드 기간 라벨 읽기 경로 변경.
