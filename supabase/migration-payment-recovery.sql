-- 가입 이탈 복구: 미입금 리마인드 원장 + 시크릿게이트 RPC.
--
-- 적용: Supabase SQL Editor에 붙여넣고 실행.
-- 사전(시크릿 등록, 1회):
--   select vault.create_secret('<무작위-긴-문자열>', 'payment_recovery_secret');
--   → Netlify 환경변수 PAYMENT_RECOVERY_SECRET 에 동일 값 주입(공개 repo 커밋 금지).
-- 시크릿 교체 시:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'payment_recovery_secret'),
--     '<새-무작위-긴-문자열>');
--   → Netlify env도 같은 값으로 교체.

-- 단계별 중복발송 방지 원장.
create table if not exists public.order_reminders (
  order_id uuid not null references public.orders(id) on delete cascade,
  stage    text not null check (stage in ('D1','D2')),
  sent_at  timestamptz not null default now(),
  primary key (order_id, stage)
);

alter table public.order_reminders enable row level security;
-- 클라이언트 직접 접근 없음. RPC(SECURITY DEFINER)로만 읽고 쓴다 → 정책 미부여(전면 차단).

-- 읽기: '입금대기' 주문 + 이미 보낸 단계. 시크릿게이트.
create or replace function public.payment_recovery_targets(p_secret text)
returns table (
  order_id         uuid,
  created_at       timestamptz,
  ship_name        text,
  ship_phone       text,
  order_no         text,
  total_amount     integer,
  has_subscription boolean,
  sent_stages      text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
    select o.id, o.created_at, o.ship_name, o.ship_phone,
           o.order_no, o.total_amount, o.has_subscription,
           coalesce(
             array_agg(r.stage) filter (where r.stage is not null),
             '{}'::text[]
           ) as sent_stages
      from public.orders o
      left join public.order_reminders r on r.order_id = o.id
     where o.status = '입금대기'
     group by o.id;
end;
$$;

-- 쓰기: 단계 기록('D1'/'D2') 또는 마감 자동취소('expire'). 시크릿게이트.
create or replace function public.apply_recovery_action(
  p_secret   text,
  p_order_id uuid,
  p_action   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_status   text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_action in ('D1', 'D2') then
    insert into public.order_reminders(order_id, stage)
      values (p_order_id, p_action)
      on conflict (order_id, stage) do nothing;
    return;
  end if;

  if p_action = 'expire' then
    select status into v_status
      from public.orders
     where id = p_order_id
     for update;
    if not found then raise exception 'order_not_found'; end if;
    -- 경합: 조회~실행 사이 입금되면 status가 바뀌므로 취소하지 않는다.
    if v_status <> '입금대기' then return; end if;

    update public.subscription_slots
       set status       = '해지',
           cancel_reason = '입금 마감 자동취소',
           cancelled_at  = v_today
     where order_id = p_order_id and status in ('신청', '대기');

    update public.orders set status = '취소' where id = p_order_id;
    return;
  end if;

  raise exception 'bad_action: %', p_action;
end;
$$;

-- anon이 시크릿을 들고 호출(시크릿게이트). 그 외 권한 회수.
revoke all on function public.payment_recovery_targets(text) from public;
revoke all on function public.apply_recovery_action(text, uuid, text) from public;
grant execute on function public.payment_recovery_targets(text) to anon;
grant execute on function public.apply_recovery_action(text, uuid, text) to anon;
