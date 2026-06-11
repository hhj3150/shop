# 방문수령 / 택배 선택 기능 — 설계 (Pickup vs. Delivery)

- 날짜: 2026-06-11
- 작성: CTO (Claude)
- 상태: 설계 확정 대기

## 1. 배경 / 목표

송영신목장(경기 안성 미양면)은 우유공장 인근 거주 고객이 많아, 택배 대신 **목장에 직접 방문해 수령**하려는 수요가 있다. 현재는 단품·구독 모두 **택배만** 가능하며 배송비가 항상 부과된다.

**목표:** 결제 시 `택배` / `방문수령`을 선택할 수 있게 하고, **방문수령을 고르면 배송비를 0원**으로 한다. 단품구매·정기구독 **모두** 적용한다.

## 2. 확정된 요구사항 (사용자 합의)

1. **단품·구독 모두** 방문수령 옵션 제공.
2. 방문수령 = 배송비 0원 (단품 4,000/5,000원, 구독 주당 4,000/5,000원 모두 제외).
3. **정기구독 방문수령**: 기존 요일 슬롯(월~금) 구조 그대로 유지 — 매주 같은 요일에 목장 방문수령. 택배비만 0.
4. **방문수령 시 수집 정보**: 이름 + 연락처만. **주소 입력칸은 숨김**. 날짜는 단품의 경우 기존 `ship_date`(발송예정일)를 "수령 가능일"로 그대로 표시, 구독은 요일 슬롯 그대로.
5. **결제화면에 방문수령 안내 문구 표시** (방문수령 선택 시): 목장 주소·운영시간·문의처.

## 3. 비목표 (Out of Scope / YAGNI)

- 방문일 직접 선택 달력, 운영시간 예약 시스템 — 도입하지 않음.
- 방문수령 전용 별도 배송 스케줄/슬롯 설계 — 하지 않음(구독은 기존 요일 슬롯 재사용).
- 외부 지도/길찾기 임베드 — 텍스트 안내만.

## 4. 현재 코드 기준 (As-Is)

### 4.1 배송비 (클라이언트)
- `lib/products.ts`
  - 단품: `onceShippingFee(subtotal, postcode)` → 일반 4,000 / 특수배송지역(제주·도서산간) 5,000. 금액 무관 항상 부과.
  - 구독: `subShippingFee(perDeliveryListTotal, postcode)` → 회당 4,000/5,000.
  - 특수지역 판정: `lib/regions.ts`의 `isSpecialDeliveryPostcode(postcode)`.
- 호출부
  - 단품: `app/order-once/page.tsx` — `const shipping = onceShippingFee(subtotal, ship.postcode); const total = subtotal + shipping;`
  - 구독: `app/checkout/page.tsx` — `const shipTotal = subShippingFee(perDelivery, ship.postcode) * weeks;`

### 4.2 주문 생성 (클라이언트 → RPC)
- `lib/orders.ts`
  - `ShippingInfo` 타입(이름/전화/주소/메모/선물/현금영수증 등). `shipPayload(ship)`가 RPC `p_ship` JSON으로 변환.
  - `createOnceOrder(items, ship, idempotencyKey)` → RPC `create_once_order(p_items, p_ship, p_idempotency_key)` (회원) / 게스트는 `create_guest_once_order`.
  - `createOrder(items, period, ship, idempotencyKey)` → RPC `create_subscription_order(p_items, p_period, p_ship, p_idempotency_key)`.
  - 결제 금액은 항상 서버 권위값(`fetchOrderAmounts`가 `orders.total_amount` 재조회). **브라우저 계산 금액은 신뢰하지 않음.**

### 4.3 서버 RPC (현재 최신 = `supabase/migration-order-idempotency.sql`)
멱등키 + 특수지역 배송비 + 적립금 자동 선차감을 모두 포함한 **현재 권위 정의**:
- `_create_once_order_core(p_uid, p_items, p_ship, p_idempotency_key)` — 게스트/회원 공용 단품 코어.
- `create_once_order(p_items, p_ship, p_idempotency_key)` — 회원 단품(코어와 유사하나 적립금 선차감 포함).
- `create_guest_once_order(p_items, p_ship, p_idempotency_key)` — core 위임.
- `create_subscription_order(p_items, p_period, p_ship, p_idempotency_key)` — 구독.

공통 패턴(세 함수 모두):
```sql
v_shipping := case when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000 else 4000 end;  -- 구독은 × v_weeks
v_total := v_subtotal + v_shipping;  -- 구독은 v_per_delivery * v_weeks + v_shipping
...
-- 배송지 검증: name·address·phone(10자리) 모두 필수
if length(trim(...address...)) = 0 ... then raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.'; end if;
insert into public.orders (... shipping_fee, ... ship_address ...) values (... v_shipping, ... );
```

> ⚠ **드리프트 주의(#53 교훈, 메모리):** Supabase RPC는 prod에 손으로 적용되며 repo가 lag할 수 있다. 본 기능 구현 시 **적용 직전 prod 실제 정의를 `select pg_get_functiondef('public.create_subscription_order(jsonb,int,jsonb,text)'::regprocedure);` 등으로 확인**하고, 본 마이그레이션의 함수 본문을 prod 기준으로 맞춘 뒤 적용한다. (특히 `create_subscription_order`는 여러 마이그레이션이 겹쳐 정의함.)

### 4.4 orders 스키마 (`supabase/schema.sql`)
주요 컬럼: `order_type('구독'|'단품')`, `has_subscription`, `total_amount`, `shipping_fee`, `ship_date`(단품), `ship_name/ship_phone/ship_postcode/ship_address/ship_address_detail`, `courier`, `tracking_no`, `shipped_at`, `idempotency_key` 등. **방문수령 관련 컬럼 없음.**

### 4.5 관리자 (`app/admin/page.tsx`)
- `OrderRow` 타입에 주문 필드. 주문/구독 목록, 배송(dispatch) 탭에서 `courier`/`tracking_no`/`shipped_at` 처리, 일괄 송장 기능 존재.
- 방문수령 개념 없음.

### 4.6 방문 안내 데이터 (재사용)
- `lib/site.ts` `BUSINESS`: `address: "경기도 안성시 미양면 미양로 466"`, `tel: "031-674-3150"`, `mobile: "010-6642-5042"`.
- `components/VisitStore.tsx`에 영업시간 문자열 `"월–금 09:00–18:00"`가 **하드코딩**되어 있음.

## 5. 설계 (To-Be)

### 5.1 데이터 모델
- `orders`에 컬럼 추가:
  ```sql
  alter table public.orders
    add column if not exists delivery_method text not null default '택배'
    check (delivery_method in ('택배','방문수령'));
  ```
  - 기존 주문은 전부 `'택배'`로 백필(default) → 하위호환·안전.
- `subscription_slots`는 **컬럼 추가 없음**. 방문수령 여부는 슬롯이 속한 주문(`order_id` → `orders.delivery_method`)으로 판단.

### 5.2 공통 상수 정리 (작은 리팩터)
- `lib/site.ts`에 `export const FARM_HOURS = "월–금 09:00–18:00";` 추가.
- `components/VisitStore.tsx`의 하드코딩 영업시간을 `FARM_HOURS`로 교체(중복 제거). 방문 안내 문구도 같은 상수 사용.

### 5.3 프론트엔드 — 결제화면 (단품 `app/order-once/page.tsx`, 구독 `app/checkout/page.tsx`)
- **수령방법 선택 UI**: `택배` / `방문수령` 라디오(또는 토글). state `deliveryMethod: '택배' | '방문수령'` (기본 `'택배'`).
- **조건부 표시**:
  - `택배`: 기존 그대로(주소·우편번호 입력, 배송비 표시).
  - `방문수령`:
    - 주소/우편번호 입력 블록 **숨김**. 이름·연락처는 유지.
    - 배송비 라인 `₩0` (또는 "방문수령 — 배송비 없음") 표시.
    - **방문 안내 박스** 노출:
      > 🏠 방문수령 안내 — 송영신목장 판매장
      > 주소: {BUSINESS.address}
      > 운영시간: {FARM_HOURS}
      > 문의: {BUSINESS.tel} · {BUSINESS.mobile}
    - 단품: "수령 가능일: {ship_date}" 표시(완료 화면/안내), 구독: 요일 슬롯 그대로.
    - (권장) `방문수령` 선택 시 **선물하기(isGift) 옵션 숨김** — 선물은 택배 발송 전제. 스코프 최소화.
- **금액 계산**: 방문수령이면 shipping 0.
  - 단품: `const shipping = deliveryMethod === '방문수령' ? 0 : onceShippingFee(subtotal, ship.postcode);`
  - 구독: `const shipTotal = deliveryMethod === '방문수령' ? 0 : subShippingFee(perDelivery, ship.postcode) * weeks;`
  - ⚠ 표시 금액은 참고용. 최종 결제액은 항상 서버 `total_amount` 재조회값 사용(기존 불변).

### 5.4 클라이언트 RPC 전달 (`lib/orders.ts`)
- `ShippingInfo`에 `deliveryMethod?: '택배' | '방문수령'` 추가(기본 택배).
- `shipPayload(ship)`에 `deliveryMethod: ship.deliveryMethod ?? '택배'` 포함.
- `createOnceOrder` / `createOrder` 시그니처는 `ship`을 통해 전달되므로 변경 최소.

### 5.5 서버 RPC 수정 (신규 마이그레이션 `supabase/migration-pickup-delivery.sql`)
**현재 prod 함수 본문(= idempotency 버전)을 기준으로** `create or replace`하여 다음만 추가:
1. `v_method text := coalesce(nullif(trim(p_ship->>'deliveryMethod'),''), '택배');` (값 검증: `'택배'|'방문수령'` 외면 예외).
2. **배송비 조건부**:
   - 단품: `v_shipping := case when v_method = '방문수령' then 0 else (case when is_special... then 5000 else 4000 end) end;`
   - 구독: `v_shipping := case when v_method = '방문수령' then 0 else (case ... end) * v_weeks end;`
3. **배송지 검증 완화**: 방문수령이면 **주소 필수 검증 제외**, 이름·연락처(10자리)만 필수.
   ```sql
   if length(trim(name)) = 0 or length(digits(phone)) < 10
      or (v_method = '택배' and length(trim(address)) = 0) then
     raise exception '받는 분·연락처를 올바르게 입력해 주세요.';
   end if;
   ```
4. `orders` insert에 `delivery_method` 컬럼 값(`v_method`) 추가. 방문수령이면 `ship_address` 등은 null 허용.
5. `ship_date`(단품) / 슬롯(구독) 로직은 **변경 없음**.
6. 멱등·적립금·슬롯·현금영수증 로직 전부 **그대로 보존**.
- 세 함수(`_create_once_order_core`, `create_once_order`, `create_subscription_order`) 모두 동일 패턴 적용. 게스트 래퍼·grant 동일 시그니처 유지(`p_ship`에 실어 보내므로 함수 시그니처 불변).

### 5.6 관리자 (`app/admin/page.tsx`)
- `OrderRow`에 `delivery_method` 추가, fetch select에 포함.
- 주문/구독 목록·360 드로어에 **`방문수령` 뱃지** 표시(택배는 기존 그대로 또는 무뱃지).
- **배송(dispatch) 탭/일괄 송장**: 방문수령 주문은 송장·택배사 대상에서 **제외/필터**(tracking_no 입력 불필요 안내). 방문수령 주문이 발송 큐에 잡혀 송장 발급되지 않도록 한다.

### 5.7 부수 영향 검토
- **입금확인 문자(발송예정일 안내)**: 현재 구매자 SMS에 "발송예정일"이 들어감(메모리: dispatch-monday). 방문수령은 발송이 없으므로, 문구가 "발송예정일"로 나가면 어색. → **2차 고려**: 방문수령 주문은 SMS 문구를 "수령 가능일" 또는 방문 안내로 분기. (구현 시 SMS 템플릿 위치 확인 후 반영, 최소한 오해 없게.)
- **PayAction/입금확인**: `order_no` 기준이라 영향 없음.
- **공휴일 발송일(`next_dispatch_date`)**: 단품 방문수령에도 "수령 가능일"로 동일 적용(별도 변경 없음).

## 6. 컴포넌트 경계 / 단위

- `DeliveryMethodSelect` (신규, 공용): 라디오 + 방문 안내 박스. 단품·구독 결제 페이지에서 공유 → 중복 방지. props: `value`, `onChange`. 안내 박스는 `value==='방문수령'`일 때만 렌더.
- `lib/site.ts`: `FARM_HOURS` 상수(단일 출처).
- RPC 마이그레이션: `migration-pickup-delivery.sql` 단일 파일, 단일 트랜잭션.

## 7. 검증 계획 (Evidence-Based)

- **타입/빌드**: `npx tsc --noEmit` 0 errors, `npm run build` 성공.
- **단위/회귀 시나리오**:
  1. 단품 택배 → total = subtotal + 4,000(또는 제주 5,000) (기존 동일).
  2. 단품 방문수령 → shipping 0, total = subtotal. 주소 미입력해도 주문 생성됨. 이름·전화 누락 시 예외.
  3. 구독 택배 → 기존 동일(주당 4,000×주수).
  4. 구독 방문수령 → shipping 0, 요일 슬롯 정상 생성, total = 상품합계×주수.
  5. 기존 주문(컬럼 default '택배') 표시·관리자 영향 없음.
  6. 멱등 재호출 시 동일 주문 반환(방문수령 포함).
- **DB**: 마이그레이션 적용 후 `delivery_method` 컬럼/`check` 확인, 방문수령 주문 row의 `shipping_fee=0`·`delivery_method='방문수령'` 확인.
- **관리자**: 방문수령 주문이 송장 발급 큐에서 제외되는지 확인.
- **prod 적용**: 메모리 정책상 `migration-pickup-delivery.sql`은 머지 후 **Supabase SQL Editor에 수동 적용** 필요. 적용 전 prod 함수 드리프트 확인.

## 8. 리스크 / 주의

1. **RPC 드리프트**: prod 실제 정의가 repo와 다를 수 있음 → 적용 직전 `pg_get_functiondef`로 확인 후 본문 동기화(#53 교훈). 가장 큰 리스크.
2. **수동 SQL 누락**: 코드 머지 후 prod SQL 미적용 시, 클라가 `deliveryMethod`를 보내도 서버가 무시 → 방문수령인데 배송비가 붙는 불일치. 배포 체크리스트에 SQL 적용 명시.
3. **선물+방문수령 조합**: 스코프 최소화 위해 방문수령 시 선물 옵션 숨김 권장(미정 시 사용자 확인).
4. **SMS 문구**: 방문수령 발송예정일 문구 어색 → 분기 처리(2차).

## 9. 작업 순서 (요약)

1. `migration-pickup-delivery.sql` 작성(prod 정의 기준) — 컬럼 추가 + 세 RPC 조건부 배송비/검증완화.
2. `lib/site.ts` `FARM_HOURS` + `VisitStore.tsx` 리팩터.
3. `DeliveryMethodSelect` 공용 컴포넌트.
4. `app/order-once/page.tsx`, `app/checkout/page.tsx` 통합(state·계산·UI).
5. `lib/orders.ts` `ShippingInfo`/`shipPayload`에 `deliveryMethod`.
6. 관리자 뱃지 + 송장 제외 필터.
7. (2차) SMS 문구 분기.
8. tsc/build/회귀 검증 → 커밋 → PR.
9. 머지 후 **prod SQL 수동 적용**.
