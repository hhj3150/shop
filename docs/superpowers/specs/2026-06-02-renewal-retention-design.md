# 설계 — 재구독 리텐션 (만료 임박 알림) (2026-06-02)

> **목표:** 활성 정기구독 회원에게 파생 만료일 D-7·D-3에 만료 임박 알림을 보내 *재구독 시작*을 유도한다. 2개월 내 정기구독 500명 목표의 **리텐션 레버**.

## 배경 / 문제

- 신규 가입 누수는 (C) 가입 이탈 복구로 메웠다. 500명은 신규뿐 아니라 **유지**도 필요하다.
- 구독 만료가 다가오는 활성 회원이 **재구독을 잊으면** 자연 이탈한다.
- 핵심 통찰: 회원이 `request_renewal()`로 재구독을 시작하면 `입금대기` 주문이 생기고, **기존 payment-recovery 크론이 입금 리마인드를 이미 담당**한다. 따라서 이 기능은 *입금 리마인드가 아니라*, 재구독을 **아직 시작 안 한** 활성 회원에게 **시작을 넛지**하는 데만 책임이 있다.

## 정책 (브레인스토밍 확정)

- **타이밍:** 파생 만료일 기준 **D-7 + D-3** (주기당 최대 2건).
- **법적 성격:** **광고성**('재구독하세요' = 구매 권유). 정보통신망법상 사전 동의 필수 → **`profiles.marketing_consent = true` 회원에게만** 발송. (발송 09:00 KST = 주간, 야간 발송 금지 준수.)
- **제외 대상:**
  1. 이미 재구독 시작 — `exists(orders where renews_slot_id = slot.id and status = '입금대기')` (payment-recovery가 이미 커버 → 이중 발송 방지)
  2. 일시정지 슬롯 — `subscription_slots.paused = true` (만료일이 계속 밀려 부정확)
  3. 이미 해당 단계 발송함 — 원장 dedup
  4. 광고 수신거부 — `marketing_consent = false`
- **record-before-send** (광고성이므로 중복 < 누락): 원장 기록을 먼저 하고 발송. 발송 실패 시 재시도 차단(누락 감수).
- **옵트아웃:** 별도 옵트아웃 흐름 없음. `marketing_consent` 단일 게이트가 동의/거부를 모두 판정.

## 파생 만료일 (SSOT 공식)

```
만료일 = started_at + (원주문.block_weeks + slot.extended_weeks) * 7일 + slot.paused_days일
```

| 항목 | 출처 |
|------|------|
| `started_at` | `subscription_slots.started_at` (활성 전환 시점) |
| `block_weeks` | 원주문 = `slot.order_id` → `orders.block_weeks` |
| `extended_weeks` | `subscription_slots.extended_weeks` (재구독 입금확인마다 누적) |
| `paused_days` | `subscription_slots.paused_days` (과거 정지 누적일) |

- **SQL에서 계산** → 집합 필터링(범위 조건). **TS에서 단계 분기**(D7 vs D3). payment-recovery와 동일 분담 철학(SQL=집합, TS=분기·메시지, vitest로 단위테스트).

## 아키텍처

매일 09:00 KST Netlify 스케줄 함수 → **시크릿게이트 SECURITY DEFINER RPC 2개**(읽기/쓰기). payment-recovery와 동일 구조이되 **시크릿·원장·함수 모두 별도로 격리**(블라스트 반경 분리). `service_role` 미사용 — anon 키 + Vault 시크릿.

```
Netlify cron (09:00 KST)
  └─ renewal_reminder_targets(secret)     [읽기 RPC: SQL이 만료일 계산·필터]
       → 각 타겟마다
          decideRenewalStage(만료일, 오늘, sent_stages)   [TS 분기]
            ├─ none → skip
            └─ D7|D3 →
                 record_renewal_reminder(secret, slot, stage, 만료일)  [쓰기 RPC, 기록 먼저]
                 sendInfo(phone, EXPIRE_SOON{고객명, 만료일})          [솔라피 발송]
```

## 단계 판정 (상호배타 윈도우)

```
decideRenewalStage(expiryDate, today, sentStages):
  d = KST 일수(today → expiryDate)
  if d < 0:   return 'none'                       # 이미 만료 — out-of-scope
  if d <= 3:  return 'D3' if 'D3' ∉ sentStages else 'none'   # D-3 윈도우에선 D7 안 보냄
  if d <= 7:  return 'D7' if 'D7' ∉ sentStages else 'none'
  return 'none'
```

- **임계값 기반(등호 아님)** → 크론이 하루 누락돼도 다음 날 복원. 회원당 주기 최대 2건.
- **상호배타:** D-3 윈도우(d≤3)에 들어가면 D7은 절대 발송 안 함(뒤늦은 'D-7' 메시지 방지).

## 데이터 모델 — 원장 `renewal_reminders`

```sql
create table if not exists public.renewal_reminders (
  slot_id     bigint not null references public.subscription_slots (id) on delete cascade,
  stage       text   not null check (stage in ('D7','D3')),
  expiry_date date   not null,
  sent_at     timestamptz not null default now(),
  primary key (slot_id, stage, expiry_date)
);
alter table public.renewal_reminders enable row level security;
-- 정책 없음: RPC(SECURITY DEFINER)로만 접근.
```

- **만료일을 PK에 포함하는 이유:** 재구독 입금확인 → `extended_weeks` 증가 → 만료일이 미뤄짐 → **새 (slot_id, stage, expiry_date) 키** → 다음 주기 D-7/D-3가 자동으로 다시 발송됨. 같은 주기 재발송만 차단하고, 다음 주기는 열어준다.

## RPC 2개 (시크릿게이트)

공통: `security definer`, `set search_path = public`, 상단에서 `p_secret`을 `vault.decrypted_secrets`의 `renewal_reminder_secret`과 비교 → 불일치 시 `raise exception 'forbidden'`. `revoke all ... from public` → `grant execute ... to anon`.

### 읽기 `renewal_reminder_targets(p_secret text)`

반환 컬럼: `slot_id bigint, name text, phone text, expiry_date date, sent_stages text[]`.

필터:
- `s.status = '활성'` AND `s.paused = false`
- `p.marketing_consent = true` (`profiles p on p.id = s.user_id`)
- 만료일 ∈ `[CURRENT_DATE(KST), CURRENT_DATE(KST) + 7]` — D-7 윈도우 커버
- `not exists (select 1 from orders where renews_slot_id = s.id and status = '입금대기')`
- `sent_stages` = `array_agg(stage)` from `renewal_reminders where slot_id = s.id and expiry_date = <계산된 만료일>` (없으면 빈 배열)

만료일 계산은 원주문 조인: `join orders o on o.id = s.order_id`, `(s.started_at + ((o.block_weeks + s.extended_weeks) * 7 + s.paused_days) * interval '1 day')::date`.

> KST 기준일: `(now() at time zone 'Asia/Seoul')::date`.

### 쓰기 `record_renewal_reminder(p_secret text, p_slot_id bigint, p_stage text, p_expiry date)`

`insert into renewal_reminders (slot_id, stage, expiry_date) values (p_slot_id, p_stage, p_expiry) on conflict do nothing;` 반환 void. (record-before-send.)

## Vault / 환경변수

- Vault 시크릿 `renewal_reminder_secret` (payment-recovery와 **별개**의 무작위 문자열).
- Netlify env `RENEWAL_REMINDER_SECRET` (동일 값). `.env.example`에 플레이스홀더 추가.

## 메시지

- 템플릿 `EXPIRE_SOON` (`SOLAPI_TEMPLATE_EXPIRE_SOON`), 변수 `#{고객명}`=name / `#{만료일}`=만료일(포맷). 본문은 솔라피 콘솔 등록분 — 코드는 변수만 채움.
- LMS 폴백: `sendInfo`가 알림톡 미설정 시 자동 LMS 대체(`lib/solapi.ts` 기존 동작).

## 함수 흐름 `netlify/functions/renewal-retention.mts`

1. env(`NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`/`RENEWAL_REMINDER_SECRET`) + `isSolapiConfigured()` 미설정 → skip 로그.
2. anon `createClient` → `renewal_reminder_targets(secret)`; error 시 500.
3. 각 타겟: `decideRenewalStage(expiry_date, now, sent_stages)` → `'none'`이면 skip.
4. `record_renewal_reminder(secret, slot_id, stage, expiry_date)` (기록 먼저); error 시 skip.
5. `phone` 없으면 skip 경고.
6. `buildRenewalMessage` → `sendInfo(phone, {text, subject, alimtalk:{templateKey:'EXPIRE_SOON', variables}})`; `!result.ok` 시 `console.warn`.
7. `export const config: Config = { schedule: "0 0 * * *" }` (00:00 UTC = 09:00 KST).

## 파일 구조

| 파일 | 책임 |
|------|------|
| `lib/renewal-retention.ts` (신규) | 순수 로직: `deriveExpiry`, `decideRenewalStage`, `buildRenewalMessage`, 타입 `RenewalTarget` |
| `lib/renewal-retention.test.ts` (신규) | vitest 단위테스트(아래) |
| `supabase/migration-renewal-retention.sql` (신규) | 원장 테이블 + RPC 2개 + Vault 안내 주석 |
| `netlify/functions/renewal-retention.mts` (신규) | 스케줄 배선 |
| `.env.example` (수정) | `RENEWAL_REMINDER_SECRET` 플레이스홀더 추가 |

`package.json` 무변경(`@netlify/functions` 기존). 모든 lib import는 상대경로(`./site` 등, payment-recovery 관례).

## 테스트 (vitest, node env, 순수 로직만)

- **`decideRenewalStage`** (8): D-8→none · D-7→D7 · D-4→D7 · D-3→D3 · D-1→D3 · D7 sentStages 포함→none · D3 sentStages 포함→none · 만료 후(d<0)→none.
- **`deriveExpiry`** (3): 기본(extended=0,paused=0) · extended_weeks 반영 · paused_days 반영.
- **`buildRenewalMessage`** (2): EXPIRE_SOON templateKey·변수 매핑 · 만료일 포맷.
- KST 경계 케이스 포함(자정 직전/직후).

## 에러 처리 / 운영

- RPC error → 함수가 로그 후 해당 항목 skip 또는 500(targets 조회 실패 시). 부분 실패가 전체 배치를 막지 않음.
- 시크릿 불일치 → RPC가 `forbidden` raise (정상 동작 — 가드).
- record-before-send로 발송 실패 시 중복 발송 대신 누락 감수(광고성 안전 우선).
- 스케줄 함수 미등록 폴백: 필요 시 GitHub Actions 크론이 시크릿 헤더 보호 라우트 호출(payment-recovery와 동일 설계 — 이번 범위 밖, 운영 메모만).

## 범위 밖 (Out of Scope)

- 영업일 기준 만료일 보정(달력일 기준 유지).
- 옵트아웃 전용 UI/흐름(`marketing_consent` 재사용).
- 재구독 자체 흐름·입금 리마인드(기존 `request_renewal` + payment-recovery 담당).
- 추천(referral) — 별도 스펙→플랜→구현 사이클.

## 검증 게이트 (이 레포 표준)

- vitest 전체 통과 + `npx tsc --noEmit` exit 0. (로컬 `next build --webpack`는 한글 경로 깨짐 — tsc+vitest로 정답성 대체, payment-recovery와 동일.)
- 공개 레포: 시크릿·계좌·신분증·사업자증 커밋 금지. 명시 파일만 스테이징, untracked jpg 2개 제외.
