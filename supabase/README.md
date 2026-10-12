# supabase/ 를 읽는 법

**이 폴더의 `.sql` 파일은 「적용 이력」이지 「현재 정의」가 아니다.**

한 함수가 여러 마이그레이션에서 `create or replace` 된다. 그래서 `grep` 으로 먼저 걸린
정의가 지금 돌아가는 정의라는 보장이 **전혀 없다**. 파일 이름도, 커밋 시각도 근거가 못 된다.

## 실제로 치른 대가

2026-09-24 외부 코드 점검이 "날짜 기준이 UTC라 한국시간 새벽에 하루 어긋난다"며
여러 함수를 지목했다. 운영 DB 를 실측하니 **지목된 함수 대부분은 이미 KST 였다.**

- 이미 KST 였던 것 — `pause_subscription`, `resume_subscription`, `skip_next_delivery`,
  `auto_resume_skips`, `change_delivery_day`, `cancel_subscription`, `confirm_payment`,
  `gen_order_no`, `cancel_unpaid_order` …
- 진짜로 UTC 가 남아 있던 것 — `cancel_skip`, `admin_set_subscription_paused`,
  `stock_adjust` (이 셋만 `migration-kst-today.sql` 로 고쳤다)

`schema.sql` 과 `migration-skip-week.sql` 의 옛 정의를 현재 정의로 믿은 탓이다.
지적을 그대로 받아 고쳤다면 **이미 KST 인 함수들을 건드려 옛 버전으로 되돌릴 뻔했다.**
운영 DB 를 직접 읽어 본 덕에 세 개만 고치고 나머지는 손대지 않았다.

## 규칙

### 1. 현재 정의는 운영 DB 에만 있다

함수 본문을 판단할 때는 **반드시** 운영 DB 에서 직접 읽는다. 저장소 파일을 근거로
"버그가 있다"고 결론짓지 않는다.

```sql
-- 현재 정의 전체
select pg_get_functiondef('public.cancel_skip(bigint)'::regprocedure);

-- 이름만 알 때 (오버로드까지)
select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f' and p.proname = 'cancel_skip';

-- 권한도 코드가 아니라 DB 가 기준이다
select grantee, privilege_type
  from information_schema.routine_privileges
 where specific_schema = 'public' and routine_name = 'cancel_skip';
```

### 2. 고칠 때는 새 마이그레이션을 쓴다

옛 파일을 고치지 않는다. 이력이 깨지고, 이미 적용된 DB 와 어긋난다.
새 `migration-*.sql` 을 만들고 맨 위에 **선행 마이그레이션**을 명시한다
(`migration-kst-today.sql` 의 `do $$ ... raise exception '선행 누락' ... $$` 형태를 따른다).

### 3. 적용 순서는 코드가 보장하지 않는다

파일 이름에 번호가 없고 러너도 없다. 사람이 순서대로 실행한다.
그래서 각 마이그레이션은 **선행 조건을 스스로 검사**하고, **멱등**이어야 한다.

## 함정 목록 — 여러 파일에 중복 정의된 함수

아래 함수들은 특히 조심한다. `grep` 이 옛 정의를 먼저 물어올 가능성이 높다.


| 함수 | 정의된 파일 수 | 마지막으로 커밋된 파일(참고용) |
| --- | --- | --- |
| `create_subscription_order` | 13 | `migration-subscription-duplicate-day-guard.sql` |
| `create_once_order` | 9 | `migration-min-order-list-basis-stock-guard.sql` |
| `request_renewal` | 9 | `migration-min-order-list-basis-stock-guard.sql` |
| `_create_once_order_core` | 8 | `migration-min-order-list-basis-stock-guard.sql` |
| `cancel_subscription` | 7 | `migration-refund-referral-credit.sql` |
| `confirm_payment` | 7 | `migration-cancelled-slot-renewal-deposit.sql` |
| `period_discount` | 7 | `schema.sql` |
| `confirm_renewal_payment` | 4 | `schema.sql` |
| `renewal_reminder_targets` | 4 | `migration-notify-gaps-2026-08.sql` |
| `apply_renewal_slot_change` | 3 | `migration-cancelled-slot-renewal-deposit.sql` |
| `create_guest_once_order` | 3 | `migration-guest-checkout.sql` |
| `gen_order_no` | 3 | `migration-guest-lookup-hardening.sql` |
| `is_special_delivery_postcode` | 3 | `migration-special-delivery-region-v2.sql` |
| `mark_cash_receipt_issued` | 3 | `migration-cash-receipt-auto-2026-08.sql` |
| `payaction_order_payload` | 3 | `migration-cash-receipt-auto-2026-08.sql` |
| `resume_subscription` | 3 | `migration-pause-missed-rounds.sql` |
| `sub_delivery_dates` | 3 | `migration-roster-weekday-integrity.sql` |
| `admin_set_subscription_paused` | 2 | `migration-kst-today.sql` |
| `apply_recovery_action` | 2 | `migration-recovery-no-auto-cancel.sql` |
| `auto_resume_skips` | 2 | `migration-pause-missed-rounds.sql` |
| `cancel_skip` | 2 | `migration-kst-today.sql` |
| `cancel_unpaid_order` | 2 | `schema.sql` |
| `closure_defers_week` | 2 | `migration-weekly-ship-rule.sql` |
| `handle_new_user` | 2 | `migration-signup-profile-trigger.sql` |
| `lookup_order_by_no_phone` | 2 | `migration-guest-lookup-hardening.sql` |
| `news_radar_insert` | 2 | `migration-news-radar-pet-category.sql` |
| `news_radar_insert_draft` | 2 | `migration-news-radar-curation.sql` |
| `next_dispatch_date` | 2 | `migration-dispatch-monday.sql` |
| `payaction_confirm` | 2 | `migration-payaction-rawbody.sql` |
| `payment_recovery_targets` | 2 | `migration-recovery-gift-payer.sql` |
| `protect_profile_admin` | 2 | `schema.sql` |
| `record_renewal_reminder` | 2 | `migration-notify-gaps-2026-08.sql` |
| `referral_qualify_on_order_paid` | 2 | `migration-referral-credit-ledger.sql` |
| `set_cash_receipt` | 2 | `schema.sql` |
| `ship_reminder_dataset` | 2 | `migration-ship-reminder-dispatched.sql` |
| `stock_adjust` | 2 | `migration-kst-today.sql` |
| `update_order_return` | 2 | `migration-order-events.sql` |

※ '마지막으로 커밋된 파일'은 참고일 뿐이다. 현재 정의는 운영 DB 만이 안다.

```
node supabase/list-redefinitions.mjs
```

위 목록은 그 스크립트가 만든다. 마이그레이션을 추가한 뒤 다시 돌려 갱신한다.
