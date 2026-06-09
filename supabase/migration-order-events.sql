-- 클레임 복기 1단계-B: 주문 이벤트 이력(order_events) + 행위자 기록.
--
-- 문제: orders.status 는 단일 mutable 컬럼이라 "언제·누가·왜 상태를 바꿨나"가 남지 않는다.
--   "배송완료로 떴는데 안 왔다", "누가 입금확인 처리했나" 류 클레임을 사후 재구성 불가.
--
-- 해결: 관리자 상태변경·발송 등을 append-only order_events 에 actor(누가)·사유와 함께 기록.
--   기존 update 로직은 보존하고(곁가지 많아 통째 RPC 라우팅은 회귀 위험), 성공 직후
--   log_order_event RPC(actor=auth.uid())로 이벤트만 남긴다. 반품 처리자도 함께 기록.
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 주문 이벤트 원장(append-only). RLS enable + 관리자 읽기. insert 는 RPC 로만.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.order_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  event       text not null,                  -- status_change / shipped / tracking_update / return 등
  from_status text,
  to_status   text,
  actor_id    uuid references auth.users(id) on delete set null,
  reason      text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at desc);

alter table public.order_events enable row level security;

drop policy if exists order_events_admin_read on public.order_events;
create policy order_events_admin_read on public.order_events
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 2. 이벤트 기록 RPC. 관리자만, actor 는 서버에서 auth.uid() 로 박는다(위조 불가).
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.log_order_event(
  p_order_id    uuid,
  p_event       text,
  p_from_status text default null,
  p_to_status   text default null,
  p_reason      text default null,
  p_meta        jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  insert into public.order_events (order_id, event, from_status, to_status, actor_id, reason, meta)
    values (p_order_id, p_event, p_from_status, p_to_status, auth.uid(), p_reason, p_meta);
end;
$$;

grant execute on function public.log_order_event(uuid, text, text, text, text, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. 반품/교환 처리자 기록: order_returns.resolved_by + update_order_return 재정의.
--    (migration-order-returns.sql 정의 보존 + resolved_by 설정만 추가.)
-- ───────────────────────────────────────────────────────────────────────────
alter table public.order_returns
  add column if not exists resolved_by uuid references auth.users(id) on delete set null;

create or replace function public.update_order_return(
  p_id         uuid,
  p_status     text,
  p_resolution text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_status not in ('접수','승인','완료','반려') then
    raise exception '처리 상태가 올바르지 않습니다.';
  end if;

  update public.order_returns
     set status      = p_status,
         resolution  = nullif(btrim(coalesce(p_resolution, '')), ''),
         resolved_at = case when p_status in ('완료','반려') then now() else null end,
         resolved_by = case when p_status in ('완료','반려') then auth.uid() else null end
   where id = p_id;

  if not found then raise exception '내역을 찾을 수 없습니다.'; end if;
end;
$$;

grant execute on function public.update_order_return(uuid, text, text) to authenticated;
