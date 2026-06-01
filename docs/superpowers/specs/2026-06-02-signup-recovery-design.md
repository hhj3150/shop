# 설계 — 가입 이탈 복구 (미입금 리마인드 + 자동취소)

> 작성일 2026-06-02 · 트랙: 전환 퍼널 강화 · 목표 2개월 내 정기구독 회원 500명
> 선행 핸드오프: `docs/superpowers/handoff-2026-06-02-conversion-funnel.md` (C) 가입 이탈 복구

## 1. 배경 / 문제

가입은 완료했으나 무통장입금을 송금하지 않은 회원이 `입금대기` 상태로 방치된다. 이는 회원 확정 전환율의 마지막 큰 누수 지점이며, 동시에 선착순 슬롯(`subscription_slots`)을 점유해 실제 입금 의사가 있는 대기자의 자리를 막는다.

현재 인프라:
- 미입금 주문 자동취소 **없음** (사용자 수동 `cancel_unpaid_order` RPC만 존재, `supabase/schema.sql:401`).
- 알림톡 템플릿 `PAYMENT_DEADLINE`(미입금 마감 임박)·`PAYMENT_GUIDE`(입금 안내)는 이미 레지스트리에 등록(`lib/notify-templates.ts:11-13`), 주석에 "트리거(cron) 별도 작업"으로 명시 — 본 설계가 그 트리거다.
- 스케줄러(cron) **없음**. 배포는 Netlify.

## 2. 정책 (확정)

기준 시각 = 주문 `created_at` (= `입금대기` 생성 시각). 일수는 **Asia/Seoul 달력일** 기준.

| 단계 | 시점 | 동작 |
|------|------|------|
| 1차 리마인드 | D+1 | 계좌·금액 재안내. 템플릿 **`PAYMENT_GUIDE`** 재사용(주문 시 발송분과 동일 — 신규 검수 불필요). |
| 2차 마감 임박 | D+2 | **`PAYMENT_DEADLINE`**, `#{마감일}` = D+3. |
| 자동취소 | D+3 초과 & 여전히 `입금대기` | 주문 `취소` + 연결 슬롯(`신청`·`대기`) `해지` → 자리 즉시 반환. SMS 없음(D+2가 이미 경고). |

- **적용 범위:** 전체 `입금대기` 주문(신규 구독·단품·구독연장 구분 없음). 슬롯 반환은 슬롯이 연결된 주문에만 적용(단품은 슬롯 없음 → 주문만 취소).
- **채널:** 기존 발송 경로 그대로 — 알림톡 우선(`SOLAPI_PRIMARY_CHANNEL=ALIMTALK`) + LMS 자동 폴백.
- **옵트아웃 없음:** 본인이 넣은 주문의 입금 안내 = 거래성 정보(광고성 아님). 기존 `order_received`·`payment_confirmed`와 동일하게 수신거부 수단 없이 발송.

## 3. 아키텍처

**Netlify Scheduled Function이 매일 1회 트리거**, 판정은 **순수 TS 함수**, 권한 작업은 **시크릿-게이트 SECURITY DEFINER RPC**가 캡슐화한다. **`service_role` 키를 사용하지 않는다.**

### 인증 모델 (service_role 미사용 근거)

이 레포의 표준 제약: *"never use `service_role`; 금액은 서버 권위 RPC에서만"*. 크론이 전체 유저의 `입금대기`를 읽으려면 RLS를 넘어야 하는데, service_role로 RLS를 우회하는 대신:

- 크론은 **anon 키 + 공유 시크릿**(`PAYMENT_RECOVERY_SECRET`, Netlify env)으로 RPC를 호출한다.
- RPC는 `SECURITY DEFINER`(소유자 권한, RLS 합법 우회)로 첫 줄에서 `p_secret`를 **Supabase Vault** 보관값과 대조 → 불일치면 `raise`. (기존 `confirm_payment`·billing RPC가 `vault.decrypted_secrets`에서 시크릿을 읽어 비교하는 것과 동일 패턴. `cancel_unpaid_order`도 SECURITY DEFINER.)
  - Vault 비밀 이름 `payment_recovery_secret`. Netlify env `PAYMENT_RECOVERY_SECRET`와 **동일 값**으로 동기화 유지.
- 금액(`total_amount`)은 RPC가 DB에서 직접 읽어 반환 → "금액은 서버 권위 RPC에서만" 충족.

→ service_role 키가 코드·env 어디에도 없음. RLS 우회는 시크릿으로 게이트된 단일 함수 안에 한정.

### 데이터 흐름

```
Netlify cron(매일 00:00 UTC = 09:00 KST)
  └─ anon supabase client
       1) rpc payment_recovery_targets(secret)         → 입금대기 주문 + 이미 보낸 단계
       2) 각 주문: decideAction(order, now)  [순수 TS]  → 'D1' | 'D2' | 'EXPIRE' | 'none'
       3) D1/D2: rpc apply_recovery_action(secret, id, action)  (원장 기록)
                 → buildRecoveryMessage(order)  [순수 TS] → sendInfo() (lib/solapi.ts 재사용)
          EXPIRE: rpc apply_recovery_action(secret, id, 'expire') (취소+슬롯반환, SMS 없음)
```

## 4. 데이터 모델

```sql
-- 단계별 중복발송 방지 원장
create table public.order_reminders (
  order_id uuid not null references public.orders(id) on delete cascade,
  stage    text not null check (stage in ('D1','D2')),
  sent_at  timestamptz not null default now(),
  primary key (order_id, stage)         -- 단계별 1회 보장(중복 insert 무시)
);
```

자동취소(EXPIRE)는 별도 원장이 불필요 — `status`가 `취소`로 바뀌면 다음 크론 조회에서 자동 제외된다.

## 5. RPC (시크릿-게이트 SECURITY DEFINER, anon에 grant)

### `payment_recovery_targets(p_secret text)` — 읽기
- 시크릿 대조 후, `status = '입금대기'`인 주문을 반환:
  `order_id, created_at, ship_name, ship_phone, order_no, total_amount, has_subscription, sent_stages text[]`
  (`sent_stages`는 `order_reminders`에서 해당 주문의 이미 보낸 단계 배열.)
- 읽기 전용. 부작용 없음.

### `apply_recovery_action(p_secret text, p_order_id uuid, p_action text)` — 쓰기
- 시크릿 대조. `p_action ∈ ('D1','D2','expire')`.
- `'D1'|'D2'`: `order_reminders(order_id, stage)` insert(`on conflict do nothing` — 멱등).
- `'expire'`: `FOR UPDATE`로 주문 잠금 후 **status가 여전히 `입금대기`일 때만** — 연결 슬롯(`신청`·`대기`) `해지`(`cancel_reason='입금 마감 자동취소'`, `cancelled_at=오늘 KST`), 주문 `취소`. (조회~실행 사이 입금 시 경합 차단.)
- `cancel_unpaid_order`(schema.sql:401)의 무인·시크릿게이트 버전. `auth.uid()` 게이트 없음.

> grant: `execute on function ... to anon` (시크릿으로 보호). `authenticated`/`service_role` 불필요.

## 6. 순수 TS 모듈 — `lib/payment-recovery.ts`

부작용 없는 함수만. 단위테스트 대상(이 레포 규칙: `lib/**/*.test.ts`, node env, TDD RED→GREEN).

```ts
type Target = { orderId: string; createdAt: string; shipName: string;
  shipPhone: string; orderNo: string; totalAmount: number;
  hasSubscription: boolean; sentStages: string[] };

// KST 달력일 경과로 단계 판정. 이미 보낸 단계는 'none' 처리(멱등).
function decideAction(t: Target, now: Date): 'D1' | 'D2' | 'EXPIRE' | 'none';

// 단계별 알림톡 변수 + LMS 폴백 텍스트 조립. DEPOSIT(lib/site.ts)에서 계좌 파생.
function buildRecoveryMessage(
  t: Target, action: 'D1' | 'D2'
): { templateKey: 'PAYMENT_GUIDE' | 'PAYMENT_DEADLINE';
     variables: Record<string, string>; subject: string; lmsText: string };
```

- `decideAction` 경계: D+0 → none, D+1 → D1, D+2 → D2, D+3 이상 → EXPIRE, 해당 단계 이미 발송 → none.
- 변수명은 `TEMPLATE_VARS`(notify-templates.ts:38-39)와 **정확히** 일치(`#{고객명}/#{주문번호}/#{금액}/#{입금계좌}` 또는 `#{마감일}`).
- `#{마감일}` = createdAt + 3일(KST) 포맷.

## 7. 컴포넌트 / 파일

| 파일 | 신규/수정 | 역할 |
|------|-----------|------|
| `lib/payment-recovery.ts` | 신규 | 순수 판정·메시지 조립. |
| `lib/payment-recovery.test.ts` | 신규 | vitest 단위테스트(경계·변수일치). |
| `supabase/migration-payment-recovery.sql` | 신규 | `order_reminders` + RPC 2개. |
| `netlify/functions/payment-recovery.mts` | 신규 | 스케줄 함수(`schedule "0 0 * * *"`). anon 클라이언트로 RPC 호출 → 순수함수 판정 → `sendInfo` 발송. 상대경로 import. |
| `.env.example` | 수정 | `PAYMENT_RECOVERY_SECRET` 자리표시자 추가(값은 Netlify env로만). |

새 색·하드코딩 없음. 계좌는 `lib/site.ts DEPOSIT`, 금액은 RPC 반환값에서 파생. immutability(스프레드, 무mutation) 준수.

## 8. 오류 처리 / 멱등성 / 보안

- **미설정 가드:** `isSolapiConfigured()` false 또는 `PAYMENT_RECOVERY_SECRET` 없음 → 함수 조용히 종료(로그만), 크래시·예외 없음.
- **전화번호 없음:** `ship_phone`는 NOT NULL이라 정상이면 항상 존재. 빈 값이면 스킵+사유 로그.
- **발송 실패 (확정: 발송 전 기록):** `apply_recovery_action`이 발송 **전** 원장에 기록한다. Solapi 실패 시 그날 그 단계는 미발송으로 종료(다음날은 단계가 경과해 자연 진행, 중복 아님). 소량(500명) 거래성 메시지에서는 드문 누락이 중복발송보다 안전하므로 발송-후-기록 대신 이 방식을 기본값으로 확정.
- **멱등성:** `order_reminders` PK(order_id, stage) + `decideAction`의 sent_stages 체크 → 같은 단계 재발송 없음. EXPIRE는 status 전이로 자연 멱등.
- **경합:** EXPIRE는 RPC 내 `FOR UPDATE` + status 재확인으로 돈·슬롯 무결성 보장.
- **시크릿:** `PAYMENT_RECOVERY_SECRET`·anon 키 모두 Netlify env로만. **공개 repo(hhj3150/shop) 커밋 금지.** service_role 미사용.

## 9. 메시지 내용 (기존 템플릿 재사용)

- **D+1 `PAYMENT_GUIDE`** 변수: `#{고객명}=ship_name, #{주문번호}=order_no, #{금액}=total_amount, #{입금계좌}=DEPOSIT 조합`. LMS 폴백은 "다시 안내드립니다" 톤.
- **D+2 `PAYMENT_DEADLINE`** 변수: `#{고객명}, #{주문번호}, #{금액}, #{마감일}=D+3`. LMS 폴백은 마감 임박 톤.
- 신규 템플릿 등록 불필요(두 키 모두 기존 레지스트리 존재).

## 10. 테스트 / 검증

- **단위(vitest):** `lib/payment-recovery.test.ts` — `decideAction` 경계 5종, `buildRecoveryMessage` 변수 정확성(2단계). TDD RED→GREEN.
- **통합(수동):** RPC·Netlify 함수·KST 일경계는 vitest 범위 밖 → Supabase에 테스트 주문 시드 후 RPC 직접 호출로 검증. 마이그레이션은 SQL Editor 적용.
- **게이트:** 완료 주장 전 같은 메시지에서 `vitest run` + `npx tsc --noEmit` 신선 실행(exit 0) 증거 제시. (로컬 `build`는 한글 경로로 깨지므로 tsc가 대체 정답성 검사.)
- **`.mts` 타입 체크:** Netlify 함수가 `tsc --noEmit` 범위에 드는지 확인. 안 들면 tsconfig include 조정 또는 함수 내 타입 최소화로 별도 점검.

## 11. 범위 밖 / 향후

- 영업일(은행 휴무) 보정 — 달력일로 단순화. 추후 필요 시 별도.
- 자동취소 알림 SMS — D+2 경고로 충분, 미발송.
- 구독 기간 4/8/12주 선택 (B) — 별도 사이클.

## 12. 미해결 / 리스크 (구현 전 확인)

1. **Netlify Scheduled Function 가용성** — 이 "MODIFIED Next.js 16" + `next build --webpack` 구성에서 `netlify/functions/*.mts` 스케줄 함수가 정상 빌드·배포되는지 실제 확인 필요. 불가 시 폴백: GitHub Actions 크론 → 시크릿 보호 라우트(동일 RPC 재사용).
2. **`PAYMENT_RECOVERY_SECRET` 길이·로테이션** — 충분히 긴 난수, Netlify env + Vault 양쪽 동기화. 로테이션 시 둘 다 교체.

> (원장 기록 시점은 §8에서 "발송 전 기록"으로 확정 — 미해결 아님.)
