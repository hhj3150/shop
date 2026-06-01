-- 정기결제(빌링키 자동결제) 도입: 카드 빌링키로 주 1회 자동 청구되는 경로.
--
-- 배경:
--   기존 결제(migration-portone-payment.sql)는 가상계좌/카드 "1회 승인" → 웹훅 confirm_payment.
--   여기서는 카드 "빌링키"를 발급받아 보관하고, PortOne 결제예약(PaymentSchedule)으로
--   주기(주 1회)마다 자동 청구한다. 자동청구 성공 웹훅이 confirm_billing_charge 를 호출한다.
--
-- 설계 요점 (보안 — confirm_payment 와 동일 원칙):
--   1) service_role 미사용. 서버 라우트/웹훅은 anon 키로 아래 RPC만 호출한다.
--   2) RPC는 SECURITY DEFINER 라 RLS를 우회하므로, 공유 시크릿(p_secret)이 Vault의
--      'billing_secret' 과 정확히 일치할 때만 동작한다. 시크릿을 모르면 즉시 거절.
--   3) 빌링키는 PG 토큰(문자열)일 뿐 카드 원번호(PAN)가 아니다. 그래도 민감하므로
--      RLS로 본인/관리자만 조회하고, 카드 식별은 표시용 끝 4자리(card_last4)만 둔다.
--   4) 금액은 항상 서버 권위값(recurring_subscriptions.amount / billing_charges.amount)과
--      대조한다. 위조된 청구금액으로는 성공 처리되지 않는다.
--   5) 멱등: 청구건(billing_charges)이 이미 '대기'가 아니면 아무 것도 바꾸지 않는다.
--
-- ── 적용 방법 (Supabase SQL Editor에서 순서대로) ──────────────────────────
--   (A) Vault에 공유 시크릿 저장 (confirm_payment_secret 과 별개의 무작위 문자열):
--         select vault.create_secret('<무작위-긴-문자열>', 'billing_secret');
--       이미 있으면 갱신:
--         select vault.update_secret(
--           (select id from vault.secrets where name = 'billing_secret'),
--           '<무작위-긴-문자열>');
--       → 같은 값을 Netlify 환경변수 BILLING_SECRET 에도 넣는다.
--   (B) 이 파일 전체를 실행한다.

-- ───────────────────────────────────────────────────────────
-- 1. 빌링키 보관 (회원당 여러 장 가능, 활성 1장을 자동결제에 사용)
-- ───────────────────────────────────────────────────────────
create table if not exists public.billing_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  billing_key  text not null unique,             -- PortOne 빌링키 토큰 (PAN 아님)
  pg_provider  text,                             -- 발급 PG (KCP/이니시스 등, 표시용)
  card_name    text,                             -- 카드사명 (표시용)
  card_last4   text,                             -- 카드번호 끝 4자리 (표시용)
  status       text not null default '활성'
               check (status in ('활성','삭제')),
  issued_at    timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists billing_keys_user_idx
  on public.billing_keys (user_id, status);

alter table public.billing_keys enable row level security;

-- 본인만 자신의 빌링키(표시 정보) 조회. INSERT/UPDATE 는 RPC 전용(직접 불가).
drop policy if exists "billing_keys_select_own" on public.billing_keys;
create policy "billing_keys_select_own" on public.billing_keys
  for select using (auth.uid() = user_id);

drop policy if exists "billing_keys_select_admin" on public.billing_keys;
create policy "billing_keys_select_admin" on public.billing_keys
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 2. 정기결제 구독 (빌링키 ↔ 주간 슬롯 ↔ 청구금액·다음청구일)
--    슬롯(subscription_slots)의 자동 연장을 책임진다. 한 슬롯당 활성 정기결제 1개.
-- ───────────────────────────────────────────────────────────
create table if not exists public.recurring_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  billing_key_id  uuid not null references public.billing_keys (id) on delete restrict,
  slot_id         bigint not null references public.subscription_slots (id) on delete cascade,
  amount          integer not null check (amount > 0),  -- 1회 청구 금액(서버 권위)
  interval_weeks  integer not null default 1 check (interval_weeks > 0),
  status          text not null default '활성'
                  check (status in ('활성','일시정지','해지')),
  next_charge_at  date,                           -- 다음 자동청구 예정일 (KST)
  schedule_id     text,                           -- PortOne 결제예약 id (표시/추적용)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 한 슬롯당 해지되지 않은 정기결제는 하나만.
create unique index if not exists recurring_subscriptions_slot_uniq
  on public.recurring_subscriptions (slot_id)
  where status <> '해지';

create index if not exists recurring_subscriptions_user_idx
  on public.recurring_subscriptions (user_id, status);

alter table public.recurring_subscriptions enable row level security;

drop policy if exists "recurring_select_own" on public.recurring_subscriptions;
create policy "recurring_select_own" on public.recurring_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "recurring_select_admin" on public.recurring_subscriptions;
create policy "recurring_select_admin" on public.recurring_subscriptions
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 3. 자동청구 건 (예약·시도·결과 기록 · 멱등/재시도(dunning) 기반)
--    예약 시 status='대기'로 1행 생성(payment_id 부여) → 웹훅 성공 시 '성공' 전환.
-- ───────────────────────────────────────────────────────────
create table if not exists public.billing_charges (
  id              uuid primary key default gen_random_uuid(),
  recurring_id    uuid not null references public.recurring_subscriptions (id) on delete cascade,
  payment_id      text not null unique,           -- PortOne paymentId (이 청구 건 식별)
  amount          integer not null check (amount > 0),
  status          text not null default '대기'
                  check (status in ('대기','성공','실패','취소')),
  attempt         integer not null default 1,     -- 재시도 회차 (dunning)
  scheduled_at    timestamptz,                    -- 예약 시각
  charged_at      timestamptz,                    -- 실제 승인 시각
  pg_tx_id        text,
  failure_code    text,
  failure_message text,
  created_at      timestamptz not null default now()
);

create index if not exists billing_charges_recurring_idx
  on public.billing_charges (recurring_id, created_at desc);

alter table public.billing_charges enable row level security;

drop policy if exists "billing_charges_select_own" on public.billing_charges;
create policy "billing_charges_select_own" on public.billing_charges
  for select using (
    exists (
      select 1 from public.recurring_subscriptions r
      where r.id = billing_charges.recurring_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "billing_charges_select_admin" on public.billing_charges;
create policy "billing_charges_select_admin" on public.billing_charges
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 4. 공유 시크릿 검증 헬퍼 (billing_secret 과 대조)
-- ───────────────────────────────────────────────────────────
create or replace function public._assert_billing_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'billing_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 5. 빌링키 저장 RPC (서버 라우트가 getBillingKeyInfo 로 검증 후 호출)
--    p_user_id 는 서버가 액세스토큰으로 검증한 본인 id 여야 한다.
--    멱등: 같은 billing_key 가 이미 있으면 표시정보만 갱신하고 그 id 반환.
-- ───────────────────────────────────────────────────────────
create or replace function public.store_billing_key(
  p_secret      text,
  p_user_id     uuid,
  p_billing_key text,
  p_pg_provider text default null,
  p_card_name   text default null,
  p_card_last4  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._assert_billing_secret(p_secret);
  if p_user_id is null or coalesce(p_billing_key, '') = '' then
    raise exception 'invalid_input';
  end if;

  insert into public.billing_keys (user_id, billing_key, pg_provider, card_name, card_last4)
  values (p_user_id, p_billing_key, p_pg_provider, p_card_name, p_card_last4)
  on conflict (billing_key) do update
    set pg_provider = coalesce(excluded.pg_provider, public.billing_keys.pg_provider),
        card_name   = coalesce(excluded.card_name,   public.billing_keys.card_name),
        card_last4  = coalesce(excluded.card_last4,  public.billing_keys.card_last4),
        status      = '활성',
        deleted_at  = null
  returning id into v_id;

  return v_id;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 6. 빌링키 해지 RPC (PG deleteBillingKey 성공 후 서버가 호출)
--    연결된 정기결제도 함께 '해지' 처리한다.
-- ───────────────────────────────────────────────────────────
create or replace function public.deactivate_billing_key(
  p_secret      text,
  p_billing_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._assert_billing_secret(p_secret);

  select id into v_id from public.billing_keys where billing_key = p_billing_key for update;
  if not found then return false; end if;

  update public.billing_keys
     set status = '삭제', deleted_at = now()
   where id = v_id;

  update public.recurring_subscriptions
     set status = '해지', updated_at = now()
   where billing_key_id = v_id and status <> '해지';

  return true;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 7. 자동청구 성공 확인 RPC (예약 결제 성공 웹훅이 호출)
--    p_payment_id  : 예약 청구 건의 PortOne paymentId (billing_charges.payment_id)
--    p_paid_amount : PG 승인 금액 (billing_charges.amount 와 일치해야 함)
--    p_pg_tx_id    : PortOne 거래번호 (정보성)
--    동작: 청구건 '성공' 전환 + 슬롯 1주기(interval_weeks) 연장 + 다음청구일 갱신.
--    멱등: 청구건이 '대기'가 아니면 변경 없이 현재 상태 반환.
--    반환: { charge_id, payment_id, status, changed, slot_id, ship_name, ship_phone }
-- ───────────────────────────────────────────────────────────
create or replace function public.confirm_billing_charge(
  p_secret      text,
  p_payment_id  text,
  p_paid_amount integer,
  p_pg_tx_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge   record;
  v_recur    record;
  v_slot     record;
begin
  perform public._assert_billing_secret(p_secret);

  -- 1) 청구건 조회 + 잠금 (동시 웹훅 재시도 대비)
  select * into v_charge from public.billing_charges
   where payment_id = p_payment_id for update;
  if not found then raise exception 'charge_not_found'; end if;

  -- 2) 금액 재검증 (서버 권위값과 일치해야 성공 처리)
  if p_paid_amount is null or p_paid_amount <> v_charge.amount then
    raise exception 'amount_mismatch: paid=% expected=%', p_paid_amount, v_charge.amount;
  end if;

  -- 3) 멱등: 이미 '대기'가 아니면 변경 없이 현재 상태 반환
  if v_charge.status <> '대기' then
    select r.slot_id into v_slot from public.recurring_subscriptions r where r.id = v_charge.recurring_id;
    return jsonb_build_object(
      'charge_id', v_charge.id, 'payment_id', v_charge.payment_id,
      'status', v_charge.status, 'changed', false,
      'slot_id', v_slot.slot_id
    );
  end if;

  -- 4) 정기결제 + 슬롯 조회
  select * into v_recur from public.recurring_subscriptions
   where id = v_charge.recurring_id for update;
  if not found then raise exception 'recurring_not_found'; end if;

  -- 5) 청구건 성공 전환
  update public.billing_charges
     set status = '성공', charged_at = now(), pg_tx_id = p_pg_tx_id
   where id = v_charge.id;

  -- 6) 슬롯 1주기 연장 (extended_weeks += interval_weeks) + 다음청구일 갱신
  update public.subscription_slots
     set extended_weeks = extended_weeks + v_recur.interval_weeks
   where id = v_recur.slot_id;

  update public.recurring_subscriptions
     set next_charge_at = coalesce(next_charge_at, (now() at time zone 'Asia/Seoul')::date)
                          + (v_recur.interval_weeks * 7),
         updated_at = now()
   where id = v_recur.id;

  select user_id into v_slot from public.subscription_slots where id = v_recur.slot_id;

  return jsonb_build_object(
    'charge_id', v_charge.id, 'payment_id', v_charge.payment_id,
    'status', '성공', 'changed', true,
    'slot_id', v_recur.slot_id
  );
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 8. 자동청구 실패 기록 RPC (예약 결제 실패 웹훅이 호출 · dunning 입력)
--    멱등: '대기'일 때만 '실패'로 전환하고 사유를 남긴다.
-- ───────────────────────────────────────────────────────────
create or replace function public.fail_billing_charge(
  p_secret          text,
  p_payment_id      text,
  p_failure_code    text default null,
  p_failure_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge record;
begin
  perform public._assert_billing_secret(p_secret);

  select * into v_charge from public.billing_charges
   where payment_id = p_payment_id for update;
  if not found then raise exception 'charge_not_found'; end if;

  if v_charge.status <> '대기' then
    return jsonb_build_object('charge_id', v_charge.id, 'status', v_charge.status, 'changed', false);
  end if;

  update public.billing_charges
     set status = '실패', failure_code = p_failure_code, failure_message = p_failure_message
   where id = v_charge.id;

  return jsonb_build_object('charge_id', v_charge.id, 'status', '실패', 'changed', true);
end;
$$;

-- 웹훅/서버 라우트는 anon 키로 호출한다(시크릿으로 보호되므로 anon 허용).
grant execute on function public.store_billing_key(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.deactivate_billing_key(text, text) to anon, authenticated;
grant execute on function public.confirm_billing_charge(text, text, integer, text) to anon, authenticated;
grant execute on function public.fail_billing_charge(text, text, text, text) to anon, authenticated;
-- _assert_billing_secret 은 내부 헬퍼라 직접 실행 권한을 주지 않는다(다른 RPC가 perform).
