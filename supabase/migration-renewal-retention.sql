-- 재구독 리텐션: 만료 임박 알림 원장 + 시크릿게이트 RPC.
--
-- 적용: Supabase SQL Editor에 붙여넣고 실행.
-- 사전(시크릿 등록, 1회) — payment_recovery_secret 과 별개의 무작위 문자열을 쓴다:
--   select vault.create_secret('<무작위-긴-문자열>', 'renewal_reminder_secret');
--   → Netlify 환경변수 RENEWAL_REMINDER_SECRET 에 동일 값 주입(공개 repo 커밋 금지).
-- 시크릿 교체 시:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'renewal_reminder_secret'),
--     '<새-무작위-긴-문자열>');
--   → Netlify env도 같은 값으로 교체.

-- 단계별 중복발송 방지 원장. expiry_date를 PK에 포함해 '주기'를 구분한다
-- (재구독 입금확인 → extended_weeks 증가 → 만료일 변경 → 새 키 → 다음 주기 재개).
create table if not exists public.renewal_reminders (
  slot_id     bigint not null references public.subscription_slots(id) on delete cascade,
  stage       text   not null check (stage in ('D7','D3')),
  expiry_date date   not null,
  sent_at     timestamptz not null default now(),
  primary key (slot_id, stage, expiry_date)
);

alter table public.renewal_reminders enable row level security;
-- 클라이언트 직접 접근 없음. RPC(SECURITY DEFINER)로만 읽고 쓴다 → 정책 미부여(전면 차단).

-- 읽기: 발송 대상 활성 슬롯 + 파생 만료일 + 이미 보낸 단계. 시크릿게이트.
-- 만료일은 SQL이 단일 권위로 계산: started_at + (원주문.block_weeks + extended_weeks)*7 + paused_days.
create or replace function public.renewal_reminder_targets(p_secret text)
returns table (
  slot_id     bigint,
  name        text,
  phone       text,
  expiry_date date,
  sent_stages text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
  with computed as (
    select s.id as slot_id,
           p.name as name,
           p.phone as phone,
           (s.started_at + ((o.block_weeks + s.extended_weeks) * 7 + s.paused_days)) as expiry_date
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       and p.marketing_consent = true
       and not exists (
         select 1 from public.orders r
          where r.renews_slot_id = s.id and r.status = '입금대기'
       )
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from computed c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between v_today and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$$;

-- 쓰기: 단계 기록('D7'/'D3'). 시크릿게이트. record-before-send.
create or replace function public.record_renewal_reminder(
  p_secret  text,
  p_slot_id bigint,
  p_stage   text,
  p_expiry  date
)
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
   where name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_stage not in ('D7', 'D3') then
    raise exception 'bad_stage: %', p_stage;
  end if;

  insert into public.renewal_reminders(slot_id, stage, expiry_date)
    values (p_slot_id, p_stage, p_expiry)
    on conflict (slot_id, stage, expiry_date) do nothing;
end;
$$;

-- anon이 시크릿을 들고 호출(시크릿게이트). 그 외 권한 회수.
revoke all on function public.renewal_reminder_targets(text) from public;
revoke all on function public.record_renewal_reminder(text, bigint, text, date) from public;
grant execute on function public.renewal_reminder_targets(text) to anon;
grant execute on function public.record_renewal_reminder(text, bigint, text, date) to anon;
