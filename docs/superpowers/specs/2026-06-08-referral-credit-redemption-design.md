# 추천 적립금(쿠폰) 자동 선차감 — 설계

- 작성일: 2026-06-08
- 상태: 승인됨 (브레인스토밍 합의 완료)
- 정책 출처: [[project_referral_credit_policy]] (메모) — 사장님과 확정한 보상 정책

## 1. 목적 / 최우선 가치

추천 보상 5,000원(추천인·친구 각자)을 **현금이 아니라 "다음 주문에서 자동 차감되는 쿠폰(적립금)"** 으로 지급한다.
무통장입금 구조라 시스템이 적립금을 반영한 **입금액을 줄여서 안내**한다.

**최우선 가치: 오해·분쟁의 소지 0.** 그래서 현금 경로는 일절 없고, 모든 조건(적립·사용·회수·만료)을
약관·화면·코드가 일치시키며, 고객이 자기 원장을 항상 본다.

## 2. 확정 규칙 (정책)

- **형식**: 현금 송금 ❌. 다음 주문 결제 시 **자동 선차감** 적립금.
- **상한**: 없음(무제한 누적).
- **사용**: 구독(신규·갱신)·단품 결제에 자동 차감. **5,000원 단위(쿠폰 1장=5,000원)로 통째 차감**, 쪼개지 않음.
  **입금액 한도까지만** 차감하고 남는 잔액은 다음 주문으로 이월. 차액 현금 환급은 **절대 없음**.
- **유효기간**: 적립일 + **1년**. 만료분은 사용 불가.
- **취소 회수(방안 ㉠)**: 친구의 첫 구독이 취소/환불되면 그 추천의 보상을 회수하되 **미사용분만 void**.
  이미 사용(applied)된 분은 회수하지 않는다(손님에게 토해내라 하지 않음 = 분쟁 0).
- **자동 적용**: 체크박스 opt-in 아님. 유효 잔액이 있으면 주문 시 자동으로 한도까지 적용.

### 5,000원 단위 차감의 의미 (명시)
입금액이 5,000의 배수가 아니면 끝자리는 손님이 입금한다.
예) 입금액 32,400원, 잔액 50,000원(10장) → 6장(30,000원) 차감 → **입금 2,400원**, 잔액 4장(20,000원) 이월.

## 3. 현재 코드 상태 (탐색 결과)

- **적립(이미 있음)**: `referral_rewards` 불변 원장(`status` earned/applied/void, `amount_krw`=5000),
  트리거 `referral_qualify_on_order_paid`(친구 `order_type='구독'` & `status='입금확인'` 시 양쪽 earned 생성),
  마이페이지 `ReferralCard.tsx`가 `referral_rewards`를 직접 조회해 earned/applied 합계 표시.
- **미구현(이번 작업)**: 만료일, 자동 선차감 사용, 입금액 반영, 취소 회수, 회수 대상 주문 식별.
- **주문 금액은 서버 권위**: 3개 주문 RPC가 `v_total`을 계산(클라가 못 바꿈, C1 무결성). 따라서 **적립금 차감도 이 RPC 안에서** 한다.
  정확한 본문 위치(여러 동명 함수가 있으니 주의):
  - `create_subscription_order` — `migration-order-integrity.sql` (v_total ~140행)
  - `create_once_order` — `migration-order-integrity.sql` (v_total ~255행)
  - `request_renewal` — ⚠ **`schema.sql:512`의 4-인자 버전(p_slot_id,p_items,p_period,p_delivery_day)이 live**.
    `migration-*-renewal*.sql`의 동명 함수들은 **폐기(superseded)**됨 — 건드리지 말 것. v_total은 `schema.sql:605`.
  - 입금액 표시는 `lib/orders.ts`의 `fetchOrderTotal`이 생성 후 `orders.total_amount`를 다시 읽어 쓰므로,
    **RPC에서 total_amount만 줄이면 결제·완료 화면 입금액이 자동으로 줄어든다**(클라 변경 불필요).
- **주문 테이블엔 할인/적립 컬럼 없음** — 추가 필요.
- **취소/환불 훅**: `cancel_subscription()`(schema.sql, 구독 해지+환불액 계산), `update_order_return()`(환불 '완료').
- **게스트 단품**(`create_guest_once_order`)은 계정이 없어 적립금 사용 불가 — 범위 밖.
- 마이그레이션은 **수기 적용 SQL**(supabase/migration-*.sql, 멱등). 프로드가 레포보다 늦을 수 있음 [[project_supabase_manual_migrations]].

## 4. 데이터 모델 변경

### 4.1 `referral_rewards` 확장 (alter, 멱등)
- `expires_at timestamptz` — 적립건 생성 시 `created_at + interval '1 year'`. 적립 트리거에서 채움.
- `applied_order_id uuid null references orders(id)` — 사용된 주문(있으면 status='applied').

### 4.2 `referrals` 확장
- `qualifying_order_id uuid null references orders(id)` — 친구 첫 구독 '입금확인' 트리거가 채운다(회수 대상 식별).

### 4.3 `orders` 확장
- `referral_credit_krw int not null default 0` — 이 주문에 적용된 적립금 차감액(표시·정산용).

> `total_amount`는 차감 후 최종 입금액으로 둔다(서버가 줄여 기록). `referral_credit_krw`는 "원래-차감" 표시를 위한 보조.
> 정산/세금 표시에 영향이 갈 수 있으므로(차감액만큼 실입금↓), 정산 패널은 별도 검토 항목으로 남긴다(§9).

## 5. 적립금 사용(선차감) — 순수 로직 분리 + RPC 적용

### 5.1 순수 함수 (TDD 대상)
`lib/referral-credit.ts`:
- `redeemableCoupons({ availableCount, orderTotal }) → { useCount, creditKrw, payable }`
  - `useCount = min(availableCount, floor(orderTotal / 5000))`
  - `creditKrw = useCount * 5000`, `payable = orderTotal - creditKrw`
- `usableBalance(rewards, nowISO) → { count, krw }` — status='earned' & `expires_at > now`인 건 수.
- 순수·결정적. React/Supabase 비의존.

### 5.2 SQL RPC 적용 (서버 권위)
새 SQL 함수 `apply_referral_credit(p_user uuid, p_total int) returns int`(차감액 반환):
- 유효(earned·미만료) 쿠폰을 **오래된 것부터** `floor(p_total/5000)`장까지 골라 `applied` + `applied_order_id` 설정.
- 차감액(장수×5000) 반환. `for update skip locked`로 동시성 보호.
3개 주문 RPC(`create_subscription_order`·`create_once_order`·`request_renewal`)에서 `v_total` 계산 직후 호출:
`v_credit := apply_referral_credit(auth.uid(), v_total); v_total := v_total - v_credit;` 그리고
`orders.referral_credit_krw := v_credit`로 기록. **차감은 항상 한도 내**(payable ≥ 0 보장).

> **실패 시맨틱(확정): 적립금 차감은 주문 생성과 동일 트랜잭션에서 원자 처리. 실패하면 주문 생성도 롤백.**
> 적립 트리거의 `exception when others then null`(silent ignore)을 **여기서는 절대 쓰지 않는다** — 금액에
> 직접 영향이 있어 조용한 무시는 이중차감·쿠폰 유실로 분쟁이 된다.

## 6. 취소·환불 회수 (방안 ㉠)

새 SQL 함수 `void_referral_rewards_for_order(p_order_id uuid)`:
- `referrals`에서 `qualifying_order_id = p_order_id`인 추천을 찾고,
- 그 추천의 `referral_rewards` 중 **status='earned'만 'void'**(미사용분만). **추천인·친구 양쪽 earned 행 모두** 회수.
  'applied'(이미 쓴 것)·'void'는 **건드리지 않는다**(㉠ — 손님에게 토해내라 하지 않음).
- 멱등(이미 void면 변화 없음).
훅:
- `cancel_subscription()`(schema.sql:335, 입력은 **슬롯**): 해지 처리 끝에 **그 슬롯의 원주문 id(`s.order_id`)**로 호출.
  ⚠ 연장(renewal) 주문 id가 아니라 **원주문 id**여야 한다 — qualifying_order_id는 친구 '첫 구독' 주문에만 박히므로,
  연장 id로 부르면 매칭이 안 돼 회수가 조용히 안 일어난다(분쟁 위험). 원주문 id로 호출할 것.
- `update_order_return()`: status='완료'(환불 완료)로 갈 때 그 반품의 `order_id`로 호출.

## 7. 화면 / 약관

- **결제 화면**(`app/checkout/page.tsx`)·**완료 화면**(`app/orders/complete/page.tsx`):
  "적립금 -10,000원 적용 → 입금액 22,400원" 형태로 차감액·최종 입금액 표시. 금액은 RPC 반환값(권위) 사용.
- **마이페이지 추천 카드**(`components/ReferralCard.tsx`): 기존 earned/applied 표시를 **유효 잔액(미만료 earned) + 만료 임박 경고 + 적립/사용 내역**으로 보강.
  ⚠ 현재 카드는 `referral_rewards`에서 `amount_krw,status`만 읽어 earned를 합산한다([ReferralCard.tsx:31-52](components/ReferralCard.tsx)).
  만료가 생긴 뒤엔 이 합산이 **만료건까지 잔액으로 과대 표시**하므로, `expires_at`도 함께 조회해 `usableBalance`
  기준(status='earned' & 미만료)으로 바꿔야 한다(안 그러면 "왜 적립금이 안 깎이냐" 분쟁).
- **약관 문구**: 적립조건(신규·첫 구독·입금확인) / 5,000원 단위 / 1년 만료 / 한도 내 차감·이월 / 취소 시 미사용분 회수 / 현금 환급 불가 — 명문화.

## 8. 테스트

- **단위(TDD)**: `lib/referral-credit.ts` — `redeemableCoupons`(배수/비배수/잔액부족/0장), `usableBalance`(만료 경계).
- **SQL**: 멱등 마이그레이션. 핵심 시나리오는 수기 검증 쿼리로 동봉:
  - 적용 → `total_amount`가 차감액만큼 줄고 `referral_credit_krw` 기록, 쿠폰 N장 `applied`.
  - 취소(미사용 상태) → 양쪽 earned만 `void`.
  - **취소 시점에 이미 `applied`(써버린 경우) → 회수 안 됨**(㉠ 최고가치 분쟁 케이스, 반드시 확인).
  - 만료건(`expires_at < now`) → 차감에서 제외되고 카드 '유효 잔액'에도 안 잡힘.
- **빌드 게이트**: `next build` + `tsc --noEmit` + `vitest run`.

## 9. 단계(증분 = PR)

- **Phase 1 — 원장 정확성**: 4.1·4.2 스키마 + 적립 트리거에 `expires_at`·`qualifying_order_id` 채우기 + §6 취소 회수 트리거.
  (사용 로직 없이도 "유효기간·회수가 올바른 원장"이 완성 → 독립적으로 가치/검증 가능.)
- **Phase 2 — 사용(선차감)**: 4.3 + §5 순수로직·RPC 적용 + §7 화면. (실제 차감·입금액 반영.)

## 10. 범위 밖 / 열린 항목

- 게스트 단품 적립금 사용(계정 없음).
- 원 단위 정밀 차감(쿠폰 쪼개기) — ㉮로 확정, 안 함.
- **정산·세금 패널 영향 (코드 확인 완료 — 과소계상 없음)**: `SettlementPanel`은 `total_amount`가 아니라
  **`order_items`의 `unit_price*qty`(상품 매출, 배송비 제외)로 매출·마진을 계산**한다([SettlementPanel.tsx:102-126](components/SettlementPanel.tsx)).
  적립금 차감은 `total_amount`(=실입금)만 줄이고 품목 단가는 그대로이므로 **정산 매출/마진 수치는 왜곡되지 않는다** —
  별도 코드 변경 불필요. (리뷰 지적 #5는 이 코드베이스엔 비해당, 근거 확인함.)
  남는 것은 *회계 판단* 한 가지: 적립금 사용분을 장부상 '에누리(매출차감)'로 볼지 '마케팅비'로 볼지 —
  이는 사장님/세무 영역의 결정이며 코드 버그가 아님. 실입금 대사(`total_amount`가 낮아짐)는 무통장 수기대사로 흡수.
