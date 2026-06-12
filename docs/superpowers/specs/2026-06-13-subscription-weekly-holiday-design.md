# 구독 주차별 공휴일 배송일 보정 — 설계

작성일: 2026-06-13 (v2 — 리뷰 반영: 비침습 로스터 일반화)

## 1. 배경·목표

신선식품(우유)은 공휴일에 택배가 출발하면 창고에 묶여 상한다. 단품(#51)·구독 첫배송(#73)은
공휴일이면 다음 영업일로 보정돼 있으나, **운영 중 정기구독의 2회차 이후 주간 배송**은 보정되지
않는다. 주간 cadence(`anchor + (k-1)*7`)가 공휴일에 걸리면 그날 명단에 잡혀 공휴일 출고 → 상함.

**목표:** 모든 구독 회차에 대해 배송 예정일이 주말·공휴일이면 다음 영업일로 미룬다. **날짜만**
옮기고 회차수·금액·환불은 불변(결정 A, §6).

**핵심 불변식(설계 전체를 지배):**
> **오늘 명단에 포함되는 주문은 변경 후에도 반드시 포함된다 — 날짜만 이동, 어떤 회차도 누락 금지.**
> 즉 공휴일 시프트는 그 슬롯의 스케줄을 계산할 수 있을 때만 적용하고, 계산할 수 없으면(슬롯
> 정보 부재 등) **오늘과 똑같이** 동작한다(보수적 포함 보존). 과소배송(회차 누락)·과배송(이중
> 발송) 둘 다 금지.

## 2. 현재 구조 (확인 완료)

- `lib/subscription-schedule.ts` `computeSchedule(input, now)`: `deliveryDate(k)` = k===1 ?
  `addDays(firstBase, 정지일)` : `addDays(anchor, (k-1)*7 + 정지일)`. `firstBase = firstShipDate ?? anchor`.
  `delivered` = `deliveryDate(k) <= today` 인 k 수(첫 미래 회차에서 break — **k 단조증가 전제**).
  `nextDate`/`endDate`도 `deliveryDate` 기반. **공휴일 보정 없음.**
- `lib/ship-date.ts` `advanceToBusinessDay(d: Date): void` — 토·일·`isHolidayISO`면 다음날로 전진
  (**Date 인자를 직접 변이**, 반환 void). `toISODate(d)`.
- `lib/holidays.ts` `isHolidayISO(iso)` — KR_HOLIDAYS(2026·2027) 조회(TS 전용).
- `lib/delivery-roster.ts` `buildRosterForDate(...)`: 정기 포함 경로 **둘** —
  ①요일매칭(`it.delivery_day === weekday`): 활성블록 게이팅(`activeBlockForDate` → `active.orderId===order_id`)
  또는 슬롯 폴백(`dispatchScheduleForSlot(fallbackSlot, order.block_weeks, dateISO).excluded`).
  **슬롯이 없으면 보수적 포함**(`if (fallbackSlot && excluded) continue` → 슬롯 없으면 미제외=포함).
  ②`first_ship_date === dateISO` 시프트분(요일 무관 포함, 앵커 당일 제외, `alreadyIncluded` 중복방지).
- `lib/dispatch-schedule.ts` `dispatchScheduleForSlot(slot, blockWeeks, shipISO)` → `computeSchedule` 위임.
- 소비자: `app/account`·`app/admin`·`PurchasePanel`·`renewal-form.ts`·`subscription-timeline.ts`
  (`refundByBlocks`)·`admin-assistant/queries.ts`(로스터·생산수요) 전부 `computeSchedule`/`buildRosterForDate` 경유.
- `#73 first_ship_date`(SQL): `started_at`=앵커, `first_ship_date`=앵커가 주말/공휴일이면 다음 영업일
  (`while dow in (0,6) or kr_holidays: +1`), 평일이면 null. **= `advanceToBusinessDay`와 동일 술어.**
- SQL `cancel_subscription`: 환불용 `delivered = 경과일/7 + 1` **독립 계산**.

## 3. 변경 설계

### 3.1 `lib/subscription-schedule.ts` — 전 회차 공휴일 시프트(날짜만)
`deliveryDate(k)` 계산 끝에 `advanceToBusinessDay` 적용(새 `Date` 복제 후 적용 — 입력 불변).
- k>=2: `anchor + (k-1)*7 + 정지일` 이 주말/공휴일이면 다음 영업일로.
- k===1: `firstBase`가 이미 #73과 **동일 술어**로 보정된 값(또는 보정 불필요한 평일 앵커)이므로
  재전진은 **no-op(idempotent)** — 증명: first_ship_date 가 set이면 그 자체가 영업일; null이면
  앵커가 평일·비공휴일(SQL이 그래서 null로 둠) → 둘 다 `advanceToBusinessDay` 무변화.
  - **전제:** `kr_holidays`(SQL)와 `lib/holidays.ts` 목록 동기(기존 연1회 동반갱신 규칙). 어긋나면
    k=1이 재이동할 수 있음 — 기존에도 존재하던 동기 전제이며 본 작업이 새 위험을 만들지 않음.
- **단조성:** 시프트 폭은 최장 연휴(예 2027 설 2/6~2/9 + 인접 주말)에도 < 7일이므로 회차 간
  날짜 역전·충돌 없음 → `delivered` break-loop 유효. 테스트로 최장 클러스터 검증(§7).

### 3.2 `lib/ship-date.ts` — `deliveryDayHitsDate` 헬퍼 신설(요일 기준 시프트)
```
export function deliveryDayHitsDate(deliveryDay: string, dateISO: string): { hits: boolean; shifted: boolean }
```
- **왜 슬롯 앵커가 아니라 요일 기준인가:** 한 슬롯의 블록 체인은 서로 다른 배송요일을 가질 수 있다
  (원주문 월요일 + 연장 화요일). 슬롯 앵커(`started_at`) cadence로 시프트를 계산하면 다른 요일 블록의
  회차를 놓쳐 **누락**된다(리뷰 발견). 시프트는 **그 품목/블록의 배송요일**에만 의존한다.
- 계산: dateISO 가 속한 주에서 `deliveryDay` 요일의 날짜(cand)를 잡고(dateISO 에서 ≤6일 역행),
  `advanceToBusinessDay(cand)` 한 결과가 dateISO 와 같으면 `hits:true`. `shifted = hits && cand !== dateISO`.
- 결과 의미: ① 평소 — dateISO 가 그 요일·평일이면 `{hits:true, shifted:false}`(cand=dateISO, 전진 no-op).
  ② 공휴일 당일 — dateISO 가 그 요일이지만 공휴일이면 전진 결과가 미래라 `{hits:false}`(시프트로 오늘 아님).
  ③ 시프트 도착일 — dateISO 가 그 요일이 아니지만, 직전 그 요일이 공휴일이라 다음 영업일이 dateISO 면
  `{hits:true, shifted:true}`. ④ 주말 dateISO — 전진 결과는 절대 주말이 아니므로 `hits:false`.
- `SUB_DAY_NUM`(mon=1..fri=5)·`advanceToBusinessDay`·`toISODate`(이 파일 내) 재사용. 순수·슬롯 비의존.
- **첫배송 통합:** 1회차도 같은 요일·공휴일 규칙을 따르므로 `first_ship_date` 별도 처리 불필요 —
  `deliveryDayHitsDate` 가 1회차 시프트(앵커 공휴일→다음 영업일)도 동일하게 판정한다.

### 3.3 `lib/delivery-roster.ts` — **정기 포함 판정을 단일 패스로 통합**
기존 ①요일매칭 ②first-ship 시프트 두 경로를 **하나의 패스**로 합친다. 날짜 일치 기준만
`it.delivery_day === weekday` → **`deliveryDayHitsDate(it.delivery_day, dateISO).hits`** 로 교체.
**활성블록 게이팅·폴백 excluded·보수적 포함(슬롯 부재 시)·해지/정지/방문수령/단품 제외·정렬·반환형은
한 글자도 바꾸지 않고 그대로 유지**(dateISO 에서 평가). 결과:
- 평소 당일 — `hits:true` → 기존 요일매칭과 동일하게 포함(게이팅 통과 시).
- 공휴일 당일 — `hits:false` → 그룹에 안 들어옴 → 제외(시프트됨). 기존 first-ship 가드도 이걸로 흡수.
- 시프트 도착일 — `hits:true(shifted)` → 포함(게이팅 통과 시). first-ship·전 회차 시프트 모두 커버.
- 단일 패스라 **이중 포함 불가**(별도 시프트 블록·`alreadyIncluded` 불필요 → 제거).

**`weekday` 파라미터 제거:** 더 이상 요일 사전필터를 안 쓰므로 `buildRosterForDate` 시그니처에서
`weekday` 제거 + 모든 호출부(예 `app/admin/page.tsx`, `lib/admin-assistant/queries.ts`) 갱신
(surgical 경계 — 명시적 제거). 사용처 grep 로 전수 확인.

**게이팅이 시프트와 정합하는 근거:** `dispatchScheduleForSlot`/`activeBlockForDate` 는 모두
`computeSchedule` 경유라 §3.1 시프트로 **endDate·delivered 가 시프트 반영**된다. 따라서 시프트된
마지막 회차일(D') 에서 `pastEnd` 오제외가 안 일어나고, 활성블록 귀속도 D' 에서 올바르다. (슬롯 부재
주문은 게이팅이 보수적 포함 → 불변식: 공휴일엔 hits:false로 빠지고 시프트일에 hits:true로 다시 포함.)

**불변식 보장(슬롯 유무 무관):** `deliveryDayHitsDate` 는 슬롯 없이 요일만으로 판정하므로, 슬롯이
없는 주문도 공휴일엔 제외·시프트일엔 포함된다 → 어떤 주문도 누락되지 않는다(날짜만 이동).

### 3.4 소비자 영향(자동 전파 + 명시 확인 대상)
- 자동 반영(표시 로직 무변경): `app/account`(다음배송일)·`app/admin`·`PurchasePanel`·`dispatch-schedule.ts`.
- **명시 확인(테스트 포함):** `renewal-form.ts`(`delivered`로 연장 회차 선택)·
  `subscription-timeline.ts` `refundByBlocks`(`delivered`로 TS측 환불 회차 산정)는 시프트된
  `delivered`를 보게 된다. 모든 TS 소비자는 `computeSchedule` 단일 경유라 **서로 일관**하게 이동한다.
  유일한 불일치는 SQL `cancel_subscription`(결정 A) 한 곳뿐.
- `admin-assistant/queries.ts`(로스터·생산수요): 블록맵 없이 `slotByOrder`만 전달. 원주문 회차는
  시프트 적용, 연장(슬롯 부재) 회차는 기존대로(불변식). **map-less 호출 회귀 테스트 추가.**

## 4. 컴포넌트 경계
- `subscription-schedule.ts`: 회차 날짜·카운트 SSOT(`computeSchedule`·내부 `deliveryDate` 시프트).
- `ship-date.ts`: 요일 기준 시프트 판정(`deliveryDayHitsDate`) + `advanceToBusinessDay`/`toISODate` 제공.
- `ship-date.ts`: `advanceToBusinessDay`/`toISODate` 제공(변경 없음, 변이 함수는 schedule 내부에서 복제본에만 적용).
- `delivery-roster.ts`: 명단 조립 — 날짜 판정을 `deliveryDayHitsDate`에 위임, 게이팅/폴백/보수포함 보존.
- 의존: roster → (schedule, ship-date) → (holidays). 단방향, 순환 없음.

## 5. 엣지·불변식
- 시프트는 항상 **앞으로**(다음 영업일). 연속 공휴일도 평일·비공휴일까지 연속 전진.
- 회차수·금액 불변. 시프트는 날짜만.
- **누락 금지 / 이중 금지:** (A)는 시프트된 회차만 요일당일에서 빼고, (B)가 정확히 그 날짜에 다시
  넣는다. 슬롯 계산 불가면 (A)도 안 빼고 (B)도 안 넣음 → 오늘과 동일. `alreadyIncluded`로 (A)·(B)
  이중포함 방지(단일 패스라 구조적으로 한 주문 하루 1회).
- 정지(pause): 게이팅(`dispatchScheduleForSlot`/`activeBlockForDate`)이 정지·소진·시작전을 제외.
  `deliveryDayHitsDate`는 날짜/요일만 보고, 회차 활성 여부는 기존 게이팅이 담당(역할 분리).
- 첫배송·연장블록·방문수령·해지·정지·회차소진 동작 보존.

## 6. 비범위 / 결정
- **환불 SQL 불변(결정 A):** `cancel_subscription`의 `경과일/7+1` 그대로. 공휴일주 해지 시 SQL 환불
  회차가 1주 미만 어긋날 수 있음(드묾) — 의도된 트레이드오프, 문서화. SQL 정렬은 별도 후속.
- TS측 `refundByBlocks`는 시프트 반영(§3.4) — SQL과 별개 경로이며 본 작업으로 일관 유지.
- 단품(#51)·첫배송(#73) 기존 보정 변경 없음. SQL 마이그레이션 없음.
- `kr_holidays`/`holidays.ts` 동반 갱신(연1회) 기존 규칙 유지.

## 7. 테스트
- `lib/subscription-schedule.test.ts`:
  - `deliveryDate` 시프트(k>=2 공휴일/주말→다음 영업일), 최장 연휴 클러스터(2027 설 2/6~2/9)에서
    연속 회차 단조·무충돌, 정지일+시프트 조합.
  - `delivered`/`nextDate`/`endDate` 시프트 반영. k=1 firstShipDate **idempotent**(set/null 양쪽 no-op).
  - `lib/ship-date.test.ts` `deliveryDayHitsDate`: 평소 당일 `{hits:true,shifted:false}`·공휴일 당일
    `hits:false`·시프트 도착일 `{hits:true,shifted:true}`·주말 `hits:false`·연속 공휴일 다중 전진.
- `lib/delivery-roster.test.ts`:
  - 공휴일 걸린 회차: **공휴일 당일 제외 + 다음 영업일 포함**(이중 없음).
  - **연장(활성블록) 슬롯**의 회차가 공휴일 주: 시프트 날짜에 올바른 블록 orderId로 포함.
  - **슬롯 부재(보수적 포함) 주문**: 시프트 미적용·오늘과 동일(누락 없음) — assistant map-less 호출 모사.
  - 해지/정지/방문수령/회차소진 제외 보존. 기존 테스트 전량 green(회귀).
- `lib/dispatch-schedule.test.ts`: 시프트 반영 회차·제외 회귀.
- (확인) `renewal-form.test.ts`·`subscription-timeline` refundByBlocks: 시프트된 delivered에서 기대 동작.

## 8. 리스크·완화
- **로스터 회귀:** 기존 2경로·게이팅·폴백 보존 + 최소 변경(A 제외가드/B 일반화) + 불변식 + 기존
  테스트 전량 유지 + 신규 시프트/연장/보수포함 케이스. TDD.
- **과소/과배송:** 불변식(§1,§5)으로 차단 — 슬롯 계산 가능할 때만 시프트, (A)와 (B)가 짝.
- **TS/SQL 환불 미세 불일치:** 결정 A 수용·문서화. TS 소비자는 일관 이동.
- **공휴일 캘린더 동기:** 기존 `kr_holidays`/`holidays.ts` 동반갱신 규칙 의존(운영 중).
