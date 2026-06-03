# 정기구독 기간 선택 (4주 / 8주 / 12주) — 설계 spec

**작성일:** 2026-06-03
**상태:** 승인됨 (사장님 "진행")
**목표:** 현재 1개월(4주) 고정인 정기구독을 4주·8주·12주 중 선택하도록 확장하여, 더 긴 선납 약정을 유도하고 2개월 내 500 구독자 목표 및 현금흐름에 기여한다.

---

## 1. 배경 / 현재 상태

- 정기구독은 **매주 1회 배송**, 요일은 월–금 중 선택. 한 번에 기간 전체를 무통장 선납.
- 현재 기간은 **1개월(=4주) 고정**, 회원 할인 10%.
- 코드는 이미 가변 기간을 전제로 설계됨:
  - `lib/products.ts`: `SubPeriod`, `SUB_PERIODS`, `PERIOD_LABEL`, `PERIOD_DISCOUNT`, `periodWeeks(months)=months*4`.
  - 서버 RPC `public.create_subscription_order(p_items, p_period, p_ship)`가 금액·주차의 **단일 권위**:
    - `v_rate := period_discount(p_period)` (null이면 `'구독 기간이 올바르지 않습니다.'` 예외 → 기간 가드 역할)
    - `v_weeks := p_period * 4`
    - per-delivery 할인단가 = `round(price*(1-rate)/10)*10`, `total = per_delivery*weeks + shipping`
    - 저장: `block_weeks=v_weeks`, `period_months=p_period`, `total_amount=v_total`
  - 재구독 리텐션(`renewal_reminder_targets`)은 만료일을 `started_at + ((block_weeks+extended_weeks)*7 + paused_days)일`로 **도출** → 기간이 길어지면 만료일·D-7/D-3 알림이 자동으로 맞춰짐.
  - 환불(`cancel_subscription`)은 `round(total_amount/block_weeks)*남은회차` → 8/12주 자동 정확.

## 2. 사장님 확정 사항

1. 기간 옵션: **4주 / 8주 / 12주**
2. 할인율: **10% / 12% / 15%** (각각 4/8/12주)
3. 결제: 선택 기간 **전체를 한 번에 선납**(무통장입금)
4. 만료/연장 알림: 기존 재구독 리텐션 그대로 **D-7 1회 · D-3 1회**
5. 기본 선택: **8주** 기본 + **'인기'** 배지, 12주에 **'최대 할인'** 배지

## 3. 핵심 설계 원칙

- **서버가 금액·할인·기간의 단일 권위.** 클라이언트 값은 표시용이며 RPC가 전량 재계산한다. 공개 repo 특성상 비밀·계좌·금액 로직 노출 없음.
- **기존 확장 포인트에 외과적으로 얹는다.** 새 추상화 없이 `period_discount`의 CASE와 `lib/products.ts`의 상수만 확장.
- **내부 모델은 '개월'(1/2/3) 유지**, 사용자 노출 라벨만 '주'(4/8/12). `period_months`는 라벨용, 만료/환불/회차는 전부 `block_weeks` 기준이라 의미 충돌 없음.

## 4. 변경 파일 (5곳)

### a. `supabase/migration-period-weeks-tiers.sql` (신규) — 서버 권위
```sql
-- 할인율 + 허용 기간을 한 함수로 정의. 1/2/3 외에는 null → RPC가 예외.
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
- `create_subscription_order` / `renew_*` 본문은 **무변경**(이미 `period_discount`·`p_period*4` 사용).
- 적용 후 `block_weeks`에 8/12 저장 → 재구독 만료일·환불·D-7/D-3 알림 **자동 적용(추가 코드 0)**.
- 멱등(`create or replace`). 적용 전후 라이브 주문 흐름 무중단(기존 1=4주는 동일하게 유지).

### b. `lib/products.ts` — 표시용 옵션/라벨/할인/배지
```ts
export type SubPeriod = 1 | 2 | 3;
export const SUB_PERIODS: SubPeriod[] = [1, 2, 3];
export const PERIOD_LABEL: Record<SubPeriod, string> = { 1: "4주", 2: "8주", 3: "12주" };
export const PERIOD_DISCOUNT: Record<SubPeriod, number> = { 1: 0.10, 2: 0.12, 3: 0.15 };
export const PERIOD_BADGE: Partial<Record<SubPeriod, string>> = { 2: "인기", 3: "최대 할인" }; // 신규
// periodWeeks(months)=months*4 그대로
// BASE_DISCOUNT = PERIOD_DISCOUNT[1] = 0.10 (상품카드 회원가 표시 기준) 그대로
// discountForPeriod(months)=PERIOD_DISCOUNT[months] 그대로(맵 확장으로 자동 동작)
```
- **불변성 준수**(새 객체/리터럴, 변형 없음). 50줄/800줄 제한 내.

### c. `components/PurchasePanel.tsx`
- 기본 선택 상태: `useState<SubPeriod>(2)` (8주).
- 기간 버튼에 `PERIOD_BADGE[m]` 있으면 배지 렌더(기존 `SUB_PERIODS.map` 루프에 배지 span 추가).
- 나머지(rate/weeks/periodTotal 계산)는 기존 로직 그대로 — 3개 옵션 자동 확장.

### d. `lib/cart.tsx`
- 카트 컨텍스트 기본 `period`를 8주(2)로 초기화. `weeks/periodTotal` 계산식은 기존 `perDelivery*weeks(+배송)` 그대로(주차만 변동).

### e. 테스트 — `lib/products.test.ts`
- `discountForPeriod(1)=0.10`, `(2)=0.12`, `(3)=0.15`
- `periodWeeks(1)=4`, `(2)=8`, `(3)=12`
- `PERIOD_LABEL` / `PERIOD_BADGE` / `SUB_PERIODS` 3단 커버리지
- 카트 합계: 각 기간별 `perDelivery*weeks(+배송)` 산식 검증(대표 1품목)
- 기존 단일-기간 가정 테스트 있으면 수정.

## 5. 데이터 흐름

```
[PurchasePanel] 기간 선택(8주 기본) + 배지
    ↓ setPeriod
[cart] {period, weeks, 표시 periodTotal}
    ↓ checkout: createOrder(items, period)
[RPC create_subscription_order(p_period)]
    period_discount(p_period) → rate(권위)
    v_weeks = p_period*4
    per_delivery = round(price*(1-rate)/10)*10
    total = per_delivery*weeks + shipping
    저장: block_weeks, period_months, total_amount
    ↓
[결제] 무통장/PortOne — 서버 total_amount 기준 (클라 금액 불신)
    ↓ 입금확인
[슬롯 활성] started_at 부여
    ↓ 매일 09:00 KST 크론
[renewal_reminder_targets] 만료일 = block_weeks 도출 → D-7 / D-3 각 1회
```

## 6. 엣지 / 안전

| 항목 | 처리 |
|---|---|
| 기존 활성 구독자(period_months=1) | 영향 없음, 슬롯 유지 |
| 최소주문 25,000원 | 회당(주간) 기준 그대로 — 기간 무관 동일 적용 |
| 환불 | `round(total/block_weeks)*남은회차` — 8/12주 자동 정확 |
| 금액 위변조 | 클라 값 전부 서버 재계산 → 안전 |
| PortOne | 주문 total 재검증, 미설정 시 무통장 폴백(무중단) |
| 잘못된 p_period | `period_discount`=null → RPC 예외 |

## 7. 테스트 전략

- **환경 제약:** 이 머신에서 vitest 4(rolldown) 번들러가 0 CPU로 멈추고, Node 25에서 tsc도 hang. → **node@22(22.22.3) + 커스텀 직접 러너**(`/tmp/vrun`)로 실제 `*.test.ts`를 실행(직전 79/79 통과 검증됨).
- **게이트:** `tsc --noEmit` exit 0 + 전체 테스트 PASS(신규 products 테스트 포함).
- **SQL:** 단위테스트 불가. 마이그레이션 적용 후 사장님이 각 기간 1건씩 테스트 주문으로 `total_amount` 육안 검증(수동 1회).

## 8. 범위 밖 (YAGNI)

- 구독 연차(tenure) 누진 할인(6개월↑15%, 1년↑20%)은 미구현 상태 유지 — 이번 기간-선택과 별개 축. 이번엔 `period_discount`만이 유일 할인.
- 기간 중도 변경/업그레이드(4주→12주 전환) UI — 추후 별도 spec.
- 정기결제(빌링키 자동청구)와의 결합 — 기존 폴백 유지.

## 9. 작업 순서(플랜에서 상세화)

1. `migration-period-weeks-tiers.sql` 작성(서버 권위) — 사장님 적용.
2. `lib/products.ts` 상수/타입 확장 + 단위테스트(TDD).
3. `lib/cart.tsx` 기본 period 8주.
4. `components/PurchasePanel.tsx` 기본 선택 + 배지.
5. 전체 게이트(tsc + 테스트) → 커밋 → (지시 시) 푸시.
