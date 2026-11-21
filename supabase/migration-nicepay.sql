-- 나이스페이먼츠 카드·간편결제(Server 승인) 결제 기록.
--
--   주문 상태는 새로 만들지 않는다. 결제 성공 = 기존 confirm_payment 로 '입금확인'(무통장과 같은 상태).
--   여기 테이블은 PG 거래 원장이다 — tid·금액·면세금액·결제수단·상태·승인시각·원본 응답.
--
--   쓰기: 서버 라우트만, SECURITY DEFINER 함수 + Vault 'confirm_payment_secret'(= 서버 env CONFIRM_PAYMENT_SECRET).
--         service_role 키를 서버에 두지 않는 기존 방식(confirm_payment·payaction_confirm)과 같다.
--   읽기: 관리자만(is_admin()). 손님·익명은 아무것도 못 본다.
--
--   빌링(정기 자동결제)은 이번 범위가 아니다. 나중에 붙일 때 kind='billing' 행을 같은 테이블에 쌓으면 된다.

create table if not exists public.payments (
  id            bigserial primary key,
  order_id      uuid not null references public.orders(id),
  order_no      text not null,
  pg            text not null default 'nicepay',
  kind          text not null default 'onetime' check (kind in ('onetime', 'billing')),
  tid           text not null unique,
  status        text not null check (status in
                  ('paid', 'failed', 'cancelled', 'partialCancelled', 'netcancelled', 'ready', 'expired')),
  amount        integer not null check (amount >= 0),          -- 승인 금액
  tax_free_amt  integer not null default 0 check (tax_free_amt >= 0), -- 승인 금액 중 면세
  balance_amt   integer,                                       -- 남은 취소 가능 금액(PG 응답 기준)
  pay_method    text,                                          -- card · kakaopay · naverpay …(PG 원값)
  approve_no    text,
  card_name     text,
  paid_at       timestamptz,
  cancelled_at  timestamptz,
  sandbox       boolean not null default false,
  raw           jsonb,                                         -- 마지막 PG 원본 응답
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payments_order_no_idx on public.payments(order_no);
create index if not exists payments_order_id_idx on public.payments(order_id);

create table if not exists public.payment_cancels (
  id               bigserial primary key,
  payment_id       bigint not null references public.payments(id),
  tid              text not null,
  cancel_order_id  text not null unique,     -- 취소 요청에 쓴 orderId(부분취소마다 고유)
  cancelled_tid    text unique,              -- PG 취소 거래 tid
  cancel_amt       integer not null check (cancel_amt > 0),
  tax_free_amt     integer not null default 0 check (tax_free_amt >= 0),
  reason           text,
  items            jsonb,                    -- 품목 선택 부분취소면 [{product_id, qty, unit_price}] + 배송비 여부
  actor_id         uuid,
  raw              jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists payment_cancels_payment_idx on public.payment_cancels(payment_id);

-- 웹훅 수신 원장 — 같은 통보가 여러 번 와도 한 번만 처리하기 위한 고유키.
create table if not exists public.payment_webhook_log (
  id           bigserial primary key,
  dedupe_key   text not null unique,
  tid          text,
  order_no     text,
  status       text,
  raw          jsonb,
  received_at  timestamptz not null default now()
);

alter table public.payments            enable row level security;
alter table public.payment_cancels     enable row level security;
alter table public.payment_webhook_log enable row level security;

drop policy if exists payments_admin_read on public.payments;
create policy payments_admin_read on public.payments for select using (public.is_admin());
drop policy if exists payment_cancels_admin_read on public.payment_cancels;
create policy payment_cancels_admin_read on public.payment_cancels for select using (public.is_admin());
drop policy if exists payment_webhook_log_admin_read on public.payment_webhook_log;
create policy payment_webhook_log_admin_read on public.payment_webhook_log for select using (public.is_admin());

revoke all on public.payments, public.payment_cancels, public.payment_webhook_log from anon;
grant select on public.payments, public.payment_cancels, public.payment_webhook_log to authenticated;

-- 공통: 시크릿 확인.
create or replace function public._nicepay_check_secret(p_secret text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_expected text;
begin
  select decrypted_secret into v_expected from vault.decrypted_secrets where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;
end $$;
revoke all on function public._nicepay_check_secret(text) from public, anon, authenticated;

-- 결제 기록(승인·조회·웹훅 결과). tid 기준 멱등. 취소된 거래를 'paid' 로 되돌리지 않는다(통보 순서 뒤바뀜 대비).
create or replace function public.nicepay_upsert_payment(
  p_secret text, p_order_no text, p_tid text, p_status text, p_amount integer,
  p_tax_free_amt integer, p_balance_amt integer, p_pay_method text, p_approve_no text,
  p_card_name text, p_paid_at timestamptz, p_cancelled_at timestamptz, p_sandbox boolean, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_order_id uuid; v_id bigint;
begin
  perform public._nicepay_check_secret(p_secret);
  select id into v_order_id from public.orders where order_no = p_order_no;
  if v_order_id is null then raise exception 'order_not_found'; end if;

  insert into public.payments as p
    (order_id, order_no, tid, status, amount, tax_free_amt, balance_amt, pay_method,
     approve_no, card_name, paid_at, cancelled_at, sandbox, raw)
  values
    (v_order_id, p_order_no, p_tid, p_status, p_amount, coalesce(p_tax_free_amt, 0), p_balance_amt,
     p_pay_method, p_approve_no, p_card_name, p_paid_at, p_cancelled_at, coalesce(p_sandbox, false), p_raw)
  on conflict (tid) do update set
    status       = case when p.status in ('cancelled', 'partialCancelled', 'netcancelled')
                             and excluded.status in ('paid', 'ready') then p.status
                        else excluded.status end,
    balance_amt  = case when p.balance_amt is null then excluded.balance_amt
                        when excluded.balance_amt is null then p.balance_amt
                        else least(p.balance_amt, excluded.balance_amt) end,
    pay_method   = coalesce(excluded.pay_method, p.pay_method),
    approve_no   = coalesce(excluded.approve_no, p.approve_no),
    card_name    = coalesce(excluded.card_name, p.card_name),
    paid_at      = coalesce(p.paid_at, excluded.paid_at),
    cancelled_at = coalesce(excluded.cancelled_at, p.cancelled_at),
    raw          = excluded.raw,
    updated_at   = now()
  returning id into v_id;

  return jsonb_build_object('payment_id', v_id, 'order_id', v_order_id);
end $$;

-- 취소 기록. cancel_order_id(요청 단위) 기준 멱등.
create or replace function public.nicepay_record_cancel(
  p_secret text, p_tid text, p_cancel_order_id text, p_cancelled_tid text, p_cancel_amt integer,
  p_tax_free_amt integer, p_reason text, p_items jsonb, p_actor uuid, p_status text,
  p_balance_amt integer, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_pid bigint; v_inserted int;
begin
  perform public._nicepay_check_secret(p_secret);
  select id into v_pid from public.payments where tid = p_tid for update;
  if v_pid is null then raise exception 'payment_not_found'; end if;

  insert into public.payment_cancels
    (payment_id, tid, cancel_order_id, cancelled_tid, cancel_amt, tax_free_amt, reason, items, actor_id, raw)
  values
    (v_pid, p_tid, p_cancel_order_id, p_cancelled_tid, p_cancel_amt, coalesce(p_tax_free_amt, 0),
     p_reason, p_items, p_actor, p_raw)
  on conflict (cancel_order_id) do nothing;
  get diagnostics v_inserted = row_count;

  update public.payments set
    status       = coalesce(p_status, status),
    balance_amt  = coalesce(p_balance_amt, balance_amt),
    cancelled_at = now(),
    raw          = coalesce(p_raw, raw),
    updated_at   = now()
  where id = v_pid;

  return jsonb_build_object('payment_id', v_pid, 'inserted', v_inserted > 0);
end $$;

-- 주문의 결제 원장 + 지금까지의 취소 합계(취소 가능액·남은 면세액 계산용).
create or replace function public.nicepay_payment_for_order(p_secret text, p_order_no text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  perform public._nicepay_check_secret(p_secret);
  select jsonb_build_object(
           'payment_id', p.id, 'tid', p.tid, 'status', p.status, 'amount', p.amount,
           'tax_free_amt', p.tax_free_amt, 'balance_amt', p.balance_amt, 'sandbox', p.sandbox,
           'cancelled_amt', coalesce((select sum(c.cancel_amt) from public.payment_cancels c where c.payment_id = p.id), 0),
           'cancelled_tax_free', coalesce((select sum(c.tax_free_amt) from public.payment_cancels c where c.payment_id = p.id), 0),
           'cancel_count', (select count(*) from public.payment_cancels c where c.payment_id = p.id)
         )
    into v
    from public.payments p
   where p.order_no = p_order_no and p.status in ('paid', 'partialCancelled', 'cancelled')
   order by p.id desc limit 1;
  return coalesce(v, jsonb_build_object('found', false));
end $$;

-- 웹훅 중복 방지: 처음 보는 통보면 true.
create or replace function public.nicepay_webhook_first_seen(
  p_secret text, p_key text, p_tid text, p_order_no text, p_status text, p_raw jsonb
) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_inserted int;
begin
  perform public._nicepay_check_secret(p_secret);
  insert into public.payment_webhook_log (dedupe_key, tid, order_no, status, raw)
    values (p_key, p_tid, p_order_no, p_status, p_raw)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end $$;

-- 처음 보는 통보였는데 처리가 실패하면 표시를 지워 재전송을 다시 받게 한다.
create or replace function public.nicepay_webhook_forget(p_secret text, p_key text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public._nicepay_check_secret(p_secret);
  delete from public.payment_webhook_log where dedupe_key = p_key;
end $$;

grant execute on function
  public.nicepay_upsert_payment(text, text, text, text, integer, integer, integer, text, text, text, timestamptz, timestamptz, boolean, jsonb),
  public.nicepay_record_cancel(text, text, text, text, integer, integer, text, jsonb, uuid, text, integer, jsonb),
  public.nicepay_payment_for_order(text, text),
  public.nicepay_webhook_first_seen(text, text, text, text, text, jsonb),
  public.nicepay_webhook_forget(text, text)
to anon, authenticated;
