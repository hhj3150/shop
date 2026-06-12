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

### 3.2 `lib/subscription-schedule.ts` — `deliversOn` 헬퍼 신설
```
export function deliversOn(input: SubInput, dateISO: string): { delivers: boolean; round: number; shifted: boolean }
```
- 시작 전(`!startedAt`)·완료·정지 중이면 `{false, 0, false}`(computeSchedule와 동일 게이팅).
- k=1..total: 시프트된 `deliveryDate(k)` ISO === dateISO 이면 `{true, round:k, shifted}` 반환
  (`shifted` = 시프트 전 원래 날짜 ISO != dateISO, 즉 공휴일로 이동된 회차인지). 최초 일치만.
- 정지일·시프트 로직은 `computeSchedule`의 `deliveryDate`와 **공유**(내부 헬퍼 추출, 중복 금지).

### 3.3 `lib/delivery-roster.ts` — **기존 2경로 보존 + 최소 일반화**
구조·시그니처(`weekday` 파라미터 포함)·활성블록 게이팅·폴백·정렬·반환형 **모두 유지**. 두 가지만 바꾼다:

**(A) 요일매칭 경로: 공휴일 당일 제외(슬롯 계산 가능할 때만).**
- `weekday` 매칭으로 들어온 주문이라도, **그 슬롯의 스케줄을 계산할 수 있고**
  `deliversOn(slotInput, dateISO).delivers === false` 이면(= 그 회차가 공휴일로 시프트돼 오늘이 아님)
  **제외**. 슬롯 계산 불가(슬롯 부재)면 **기존 동작 그대로**(보수적 포함) — 불변식 보장.
- 활성블록 경로(연장)도 동일: 활성블록이 있어도 `deliversOn`(해당 블록 슬롯 입력)이 오늘을 배송일로
  보지 않으면 제외(시프트됨). 슬롯 입력이 없으면 기존대로.

**(B) 시프트 포함 경로: first-ship 전용 → 전 회차 일반화.**
- 기존 "`first_ship_date === dateISO`" 블록을 "**`deliversOn(slotInput, dateISO)`가
  `{delivers:true, shifted:true}`** 인 슬롯 포함"으로 확장. 즉 어떤 회차든 공휴일로 오늘(다음 영업일)에
  이동돼 온 건을 포함. (`shifted:false`는 (A)의 요일경로가 이미 처리하므로 여기선 제외 — 이중포함 방지.)
- 기존 보존: 확인됨·미정지·미해지·방문수령 제외·`alreadyIncluded` 중복방지. 활성블록(연장)
  주문이면 시프트된 dateISO 기준 `activeBlockForDate` 로 `active.orderId === order_id` 확인 후 포함
  (요일경로와 동일 게이팅을 시프트 날짜에 평가).
- 슬롯 계산 불가 주문은 이 경로 대상 아님(=오늘과 동일하게 시프트 안 함 → 불변식: 요일경로(A)에서
  슬롯 불가라 제외도 안 했으므로 누락 없음).

**slotInput 매핑:** `DispatchSlotInfo` → `SubInput`(started_at, firstShipDate=first_ship_date,
totalWeeks, paused 류). `dispatchScheduleForSlot`이 이미 같은 매핑을 하므로 그 패턴/헬퍼 재사용.
연장 totalWeeks 는 게이팅용 활성블록이 orderId로 회차를 귀속하므로, deliversOn 의 total 은
**활성블록 슬롯 총회차**를 쓴다(요일경로 폴백은 기존대로 `order.block_weeks`).

### 3.4 소비자 영향(자동 전파 + 명시 확인 대상)
- 자동 반영(표시 로직 무변경): `app/account`(다음배송일)·`app/admin`·`PurchasePanel`·`dispatch-schedule.ts`.
- **명시 확인(테스트 포함):** `renewal-form.ts`(`delivered`로 연장 회차 선택)·
  `subscription-timeline.ts` `refundByBlocks`(`delivered`로 TS측 환불 회차 산정)는 시프트된
  `delivered`를 보게 된다. 모든 TS 소비자는 `computeSchedule` 단일 경유라 **서로 일관**하게 이동한다.
  유일한 불일치는 SQL `cancel_subscription`(결정 A) 한 곳뿐.
- `admin-assistant/queries.ts`(로스터·생산수요): 블록맵 없이 `slotByOrder`만 전달. 원주문 회차는
  시프트 적용, 연장(슬롯 부재) 회차는 기존대로(불변식). **map-less 호출 회귀 테스트 추가.**

## 4. 컴포넌트 경계
- `subscription-schedule.ts`: 날짜 SSOT(`computeSchedule`·`deliversOn`·내부 `deliveryDate`/시프트 헬퍼).
- `ship-date.ts`: `advanceToBusinessDay`/`toISODate` 제공(변경 없음, 변이 함수는 schedule 내부에서 복제본에만 적용).
- `delivery-roster.ts`: 명단 조립 — 날짜 판정을 `deliversOn`에 위임, 게이팅/폴백/보수포함 보존.
- 의존: roster → schedule → (ship-date, holidays). 단방향, 순환 없음.

## 5. 엣지·불변식
- 시프트는 항상 **앞으로**(다음 영업일). 연속 공휴일도 평일·비공휴일까지 연속 전진.
- 회차수·금액 불변. 시프트는 날짜만.
- **누락 금지 / 이중 금지:** (A)는 시프트된 회차만 요일당일에서 빼고, (B)가 정확히 그 날짜에 다시
  넣는다. 슬롯 계산 불가면 (A)도 안 빼고 (B)도 안 넣음 → 오늘과 동일. `alreadyIncluded`로 (A)·(B)
  이중포함 방지. `deliversOn`은 (slot,date)당 최대 1회차 → 한 주문 하루 1회.
- 정지(pause): 정지일만큼 민 뒤 영업일 전진(순서: pause-offset → shift). deliversOn/computeSchedule 동일.
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
  - `deliversOn`: 시프트 날짜 true·`shifted` 플래그·공휴일 당일 false·시작전/정지/완료 false·(slot,date) 1회차.
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
