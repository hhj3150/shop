-- 퍼널 측정: 익명 세션 기반 전환 이벤트(개인정보 없음).
--   단계: visit → view_product → add_to_cart → begin_checkout → purchase.
--   익명 삽입만 허용(분석), 조회·집계는 관리자만.
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

create table if not exists public.funnel_events (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null,        -- 브라우저 익명 ID(개인정보 아님)
  event      text not null,        -- visit|view_product|add_to_cart|begin_checkout|purchase
  path       text,
  created_at timestamptz not null default now()
);
create index if not exists funnel_events_created_idx on public.funnel_events (created_at);
create index if not exists funnel_events_event_idx on public.funnel_events (event);

alter table public.funnel_events enable row level security;

-- 익명 삽입만 허용(분석 이벤트 기록). 조회는 차단.
drop policy if exists "funnel_insert_anon" on public.funnel_events;
create policy "funnel_insert_anon" on public.funnel_events
  for insert to anon, authenticated with check (true);

-- 관리자만 원본 조회.
drop policy if exists "funnel_select_admin" on public.funnel_events;
create policy "funnel_select_admin" on public.funnel_events
  for select using (public.is_admin());

-- 기간 퍼널 요약: 이벤트별 '고유 세션 수'. 관리자만.
create or replace function public.funnel_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  select jsonb_object_agg(event, cnt) into v
    from (
      select event, count(distinct session_id) as cnt
        from public.funnel_events
       where created_at >= p_from
         and created_at < (p_to + interval '1 day')
       group by event
    ) t;
  return coalesce(v, '{}'::jsonb);
end;
$$;

grant execute on function public.funnel_summary(date, date) to authenticated;
