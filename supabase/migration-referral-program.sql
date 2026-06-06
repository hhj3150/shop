-- ─────────────────────────────────────────────────────────────
-- 리퍼럴(친구 추천) 프로그램 — Phase 1 (additive: 기존 머니-RPC 미수정)
--
--   • 회원별 고유 추천코드(profiles.referral_code)
--   • referrals(추천 관계) + referral_rewards(불변 보상 원장)
--   • 친구의 첫 정기구독 '입금확인' 시 양쪽 5,000원 보상 자동 획득(트리거)
--   • 관리자 대시보드용 조회/적용/무효 RPC
--
--   약속 보장: 보상은 원장에 영구 기록 + 관리자 모드 노출 → 누락 구조적으로 불가.
--   ⚠ 보상 금액은 lib/referral.ts 의 REFERRAL_REWARD_KRW(5000) 와 동기화.
--   적용: Supabase SQL Editor 에서 이 파일 전체 1회 실행(멱등).
-- ─────────────────────────────────────────────────────────────

-- 1) 회원별 고유 추천코드.
alter table public.profiles
  add column if not exists referral_code text unique;

-- 2) 보상 금액(단일 출처). lib/referral.ts 와 동기화.
create or replace function public.referral_reward_amount()
returns int language sql immutable as $$ select 5000; $$;

-- 3) 고유 추천코드 생성(혼동문자 0·O·1·I·L 제외, 8자리).
create or replace function public.gen_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
  tries int := 0;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_code = code);
    tries := tries + 1;
    if tries > 50 then raise exception '추천코드 생성 실패(중복)'; end if;
  end loop;
  return code;
end;
$$;

-- 4) 내 추천코드 조회(없으면 생성).
create or replace function public.get_or_create_my_referral_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  select referral_code into v_code from public.profiles where id = v_uid;
  if v_code is null then
    v_code := public.gen_referral_code();
    update public.profiles set referral_code = v_code where id = v_uid;
  end if;
  return v_code;
end;
$$;

grant execute on function public.get_or_create_my_referral_code() to authenticated;

-- 5) 추천 관계.
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references public.profiles (id) on delete cascade,
  referee_id   uuid not null unique references public.profiles (id) on delete cascade,  -- 1인 1추천인
  code         text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'qualified', 'void')),
  created_at   timestamptz not null default now(),
  qualified_at timestamptz
);
create index if not exists idx_referrals_referrer on public.referrals (referrer_id);

alter table public.referrals enable row level security;
drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referee_id);
drop policy if exists "referrals_select_admin" on public.referrals;
create policy "referrals_select_admin" on public.referrals
  for select using (public.is_admin());
-- 쓰기는 security definer RPC/트리거로만(클라 insert/update 정책 없음).

-- 6) 보상 원장(불변 기록).
create table if not exists public.referral_rewards (
  id           uuid primary key default gen_random_uuid(),
  referral_id  uuid not null references public.referrals (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('referrer', 'referee')),
  amount_krw   int  not null,
  status       text not null default 'earned'
               check (status in ('earned', 'applied', 'void')),
  note         text,
  created_at   timestamptz not null default now(),
  applied_at   timestamptz,
  unique (referral_id, role)  -- 추천 1건당 역할별 보상 1회(멱등)
);
create index if not exists idx_rewards_user on public.referral_rewards (user_id);

alter table public.referral_rewards enable row level security;
drop policy if exists "rewards_select_own" on public.referral_rewards;
create policy "rewards_select_own" on public.referral_rewards
  for select using (auth.uid() = user_id);
drop policy if exists "rewards_select_admin" on public.referral_rewards;
create policy "rewards_select_admin" on public.referral_rewards
  for select using (public.is_admin());

-- 7) 추천 등록(신규 피추천인이 가입 직후 호출).
create or replace function public.claim_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_code     text;
  v_referrer uuid;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) <> 8 then raise exception '추천코드 형식이 올바르지 않습니다.'; end if;

  select id into v_referrer from public.profiles where referral_code = v_code;
  if v_referrer is null then raise exception '존재하지 않는 추천코드입니다.'; end if;
  if v_referrer = v_uid then raise exception '본인 추천코드는 사용할 수 없습니다.'; end if;
  if exists (select 1 from public.referrals where referee_id = v_uid) then
    raise exception '이미 추천이 등록되어 있습니다.';
  end if;
  -- 기존 구독 이력이 있으면 신규가 아님(어뷰징 차단).
  if exists (
    select 1 from public.orders
     where user_id = v_uid and order_type = '구독'
       and status in ('입금확인', '배송준비', '배송중', '배송완료')
  ) then
    raise exception '추천은 신규 회원만 등록할 수 있습니다.';
  end if;

  insert into public.referrals (referrer_id, referee_id, code, status)
  values (v_referrer, v_uid, v_code, 'pending');
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.claim_referral(text) to authenticated;

-- 8) 자격 부여 트리거 — 친구의 첫 정기구독 '입금확인' 시 양쪽 보상 자동 획득.
--    ★ 머니 플로우 보호: 리퍼럴 처리 실패가 주문 확정을 절대 막지 않도록 예외 전부 무시.
create or replace function public.referral_qualify_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_amt int;
begin
  begin
    if new.order_type = '구독' and new.status = '입금확인' then
      select * into v_ref from public.referrals
        where referee_id = new.user_id and status = 'pending'
        for update skip locked;
      if found then
        v_amt := public.referral_reward_amount();
        update public.referrals
           set status = 'qualified', qualified_at = now()
         where id = v_ref.id;
        insert into public.referral_rewards (referral_id, user_id, role, amount_krw, status)
        values (v_ref.id, v_ref.referrer_id, 'referrer', v_amt, 'earned'),
               (v_ref.id, v_ref.referee_id,  'referee',  v_amt, 'earned')
        on conflict (referral_id, role) do nothing;
      end if;
    end if;
  exception when others then
    null;  -- 리퍼럴 실패는 조용히 무시(주문 확정 보호). 관리자 수동 보정 가능.
  end;
  return new;
end;
$$;

drop trigger if exists trg_referral_qualify on public.orders;
create trigger trg_referral_qualify
  after insert or update on public.orders
  for each row execute function public.referral_qualify_on_order_paid();

-- 9) 관리자: 현황+원장 조회.
create or replace function public.referral_admin_list()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  return (
    select coalesce(jsonb_agg(row order by row->>'created_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', r.id, 'status', r.status, 'code', r.code,
        'created_at', r.created_at, 'qualified_at', r.qualified_at,
        'referrer_name', pr.name, 'referee_name', pe.name,
        'rewards', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', rw.id, 'user_id', rw.user_id, 'role', rw.role,
            'amount_krw', rw.amount_krw, 'status', rw.status,
            'note', rw.note, 'applied_at', rw.applied_at)), '[]'::jsonb)
          from public.referral_rewards rw where rw.referral_id = r.id
        )
      ) as row
      from public.referrals r
      left join public.profiles pr on pr.id = r.referrer_id
      left join public.profiles pe on pe.id = r.referee_id
    ) t
  );
end;
$$;

grant execute on function public.referral_admin_list() to authenticated;

-- 10) 관리자: 보상 적용/무효 처리.
create or replace function public.referral_reward_mark_applied(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  update public.referral_rewards
     set status = 'applied', applied_at = now(),
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'earned';
  if not found then raise exception '적용 가능한(미적용) 보상이 아닙니다.'; end if;
end;
$$;

grant execute on function public.referral_reward_mark_applied(uuid, text) to authenticated;

create or replace function public.referral_reward_void(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  update public.referral_rewards
     set status = 'void',
         note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status <> 'void';
  if not found then raise exception '무효 처리할 보상이 아닙니다.'; end if;
end;
$$;

grant execute on function public.referral_reward_void(uuid, text) to authenticated;

-- ───────── 검증(선택) ─────────
--   select public.referral_reward_amount();              -- 5000
--   select public.get_or_create_my_referral_code();      -- (로그인 상태에서) 8자리 코드
--   select policyname from pg_policies where tablename in ('referrals','referral_rewards');
--   select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and tgname='trg_referral_qualify';
