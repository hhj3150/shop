# 리퍼럴(친구 추천) 프로그램 — 설계

> 작성일 2026-06-06 · 상태: 설계(결정 완료) · 트랙: 획득(acquisition) 레버 · 목표 정기구독 500명

## 결정 요약 (마케팅 팀장 + CTO)

- **보상**: 양방향 대칭, **추천인·피추천인 각 `REFERRAL_REWARD_KRW = 5,000원`** (단일 상수, 조정 용이).
  - 근거: 월 ~10만원대 구독 기준 ~5%로 마진 안전, 메시지 단순. 프리미엄·신뢰 기반 제품은 입소문이 최저 CAC.
- **획득 조건(어뷰징 차단)**: 피추천인(친구)의 **첫 정기구독 결제가 확정될 때** 양쪽 보상 획득.
  - 자기추천 불가 · 피추천인은 기존 구독 이력 없는 신규만 · 1인당 추천인 1명.
- **약속 보장**: 모든 보상은 **불변 원장(`referral_rewards`)에 영구 기록**, 관리자 대시보드가 전부 노출.
  누락이 구조적으로 불가능. 관리자가 적용/무효 처리.

## 왜 이 구조인가 (additive · 머니-RPC 비수정)

`create_subscription_order`·결제 확정·`request_renewal`은 6+개 마이그레이션에 걸친 머니-크리티컬 RPC.
직접 차감 로직을 끼우면 회귀 위험이 큼. 따라서:

- **획득**: 결제 확정 테이블에 **AFTER 트리거**(additive) → 기존 RPC 본문 미수정.
- **기록/보증**: 원장 + 관리자 모드(사장님 요구사항과 일치).
- **차감(redemption)**: 자동 차감은 머니-RPC 수정이라 **Phase 2**로 분리. 원장이 있어 약속은 이미 보장됨.

## 데이터 모델 (신규, additive)

```
profiles.referral_code  text unique        -- 회원별 고유 추천코드(대문자+숫자 8자리)

referrals
  id uuid pk
  referrer_id uuid → profiles   -- 추천한 사람
  referee_id  uuid → profiles unique  -- 추천받은 사람(1인 1추천인)
  code text                     -- 사용된 코드(감사용)
  status text  -- 'pending'(가입) | 'qualified'(첫결제확정) | 'void'(취소·어뷰징)
  created_at, qualified_at

referral_rewards   -- 불변 원장(약속 보증)
  id uuid pk
  referral_id uuid → referrals
  user_id uuid → profiles       -- 보상 받는 사람
  role text   -- 'referrer' | 'referee'
  amount_krw int
  status text -- 'earned' | 'applied' | 'void'
  note text                     -- 적용/무효 사유(관리자)
  created_at, applied_at
```

RLS: 본인 referrals/rewards 조회 가능 · 관리자 전체(`public.is_admin()`).

## RPC / 트리거

- `get_or_create_my_referral_code()` → text : 내 코드 없으면 생성 후 반환(authenticated).
- `claim_referral(p_code text)` : 신규 피추천인이 가입 직후 호출. 검증(자기추천·중복·신규·코드존재) 후 referrals(pending) 생성.
- **트리거** `on_first_payment_qualify_referral` : 첫 결제 확정 시 해당 피추천인의 pending referral → qualified + 양쪽 `referral_rewards`(earned) 1행씩 삽입(멱등).
- 관리자: `referral_admin_list()` (현황+원장 조인), `referral_reward_mark_applied(p_id, p_note)`, `referral_reward_void(p_id, p_note)` — 모두 `is_admin()` 게이트.

## 프론트엔드

- **마이페이지 "친구 추천" 카드**: 내 코드·공유 링크(`/?ref=CODE`) + 복사/카톡공유 + 내 획득 보상 내역.
- **가입/체크아웃**: 추천코드 입력란(URL `?ref=`로 자동 채움) → `claim_referral` 호출.
- **관리자 탭**: 리퍼럴 현황(추천 관계·상태) + 보상 원장(획득/적용/무효, 합계) + 적용/무효 버튼.

## 단계

- **Phase 1 (이번)**: DB(테이블·RLS·코드생성·claim·트리거) + 코드생성 순수함수(TDD) + 마이페이지 카드 + 관리자 대시보드 + 코드 입력. → 약속 획득·기록·관리자 보증까지 완성.
- **Phase 2 (분리)**: 다음 정기결제 자동 차감(머니-RPC 수정, 신중 회귀검증). 그 전까지는 관리자가 원장 보고 적용.

## 검증

- 코드 생성·검증·정규화: 순수함수 vitest(TDD).
- DB: 마이그레이션 수동 적용 + 파일 하단 검증 SQL.
- tsc + vitest 전체 green. 라이브 눈 확인(관리자·마이페이지).

## 비고 / 리스크

- 결제 확정 경로가 둘(PortOne 자동결제 `billing_charges.성공`, PayAction 무통장 `입금확인`).
  트리거는 두 경로 모두에서 '첫 결제 확정'을 잡도록 설계(없으면 관리자 수동 qualify로 보강).
- PUBLIC repo — 시크릿 금지. 마이그레이션 수동 적용.
