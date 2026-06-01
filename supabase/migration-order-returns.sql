-- ─────────────────────────────────────────────────────────────
-- 환불/교환 워크플로 (order_returns)
--   단품·구독 주문에 대한 환불/교환 요청을 상태로 관리하는 원장(ledger).
--   기존 구독 해지 환불(subscription_slots.refund_*)과 별개로, 주문 단위의
--   환불/교환 처리 이력을 남긴다. 금액 변동(실제 송금)은 관리자가 수기 처리하고
--   여기서는 상태·금액·사유만 추적한다.
--   쓰기는 SECURITY DEFINER RPC(관리자 전용)로만 — 직접 INSERT/UPDATE 불가.
-- 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.order_returns (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  type        text not null check (type in ('환불','교환')),
  status      text not null default '접수'
              check (status in ('접수','승인','완료','반려')),
  reason      text,
  amount      integer not null default 0 check (amount >= 0), -- 환불 금액(원). 교환은 0 가능.
  resolution  text,                                           -- 처리 메모(관리자).
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists order_returns_order_idx on public.order_returns (order_id);

alter table public.order_returns enable row level security;

-- 본인 주문의 환불/교환 내역 조회.
drop policy if exists "returns_select_own" on public.order_returns;
create policy "returns_select_own" on public.order_returns
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_returns.order_id and o.user_id = auth.uid()
    )
  );

-- 관리자는 전체 조회.
drop policy if exists "returns_select_admin" on public.order_returns;
create policy "returns_select_admin" on public.order_returns
  for select using (public.is_admin());

-- INSERT/UPDATE 직접 권한 없음 — 아래 RPC 로만 기록.

-- ── 관리자: 환불/교환 접수 등록 ──
create or replace function public.create_order_return(
  p_order_id uuid,
  p_type     text,
  p_reason   text default null,
  p_amount   int  default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_type not in ('환불','교환') then
    raise exception '유형은 환불 또는 교환이어야 합니다.';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception '주문을 찾을 수 없습니다.';
  end if;

  insert into public.order_returns (order_id, type, reason, amount)
  values (p_order_id, p_type, nullif(btrim(coalesce(p_reason, '')), ''), greatest(0, coalesce(p_amount, 0)))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_order_return(uuid, text, text, int) to authenticated;

-- ── 관리자: 환불/교환 상태 전환(승인/완료/반려) + 처리 메모 ──
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
         resolved_at = case when p_status in ('완료','반려') then now() else null end
   where id = p_id;

  if not found then raise exception '내역을 찾을 수 없습니다.'; end if;
end;
$$;

grant execute on function public.update_order_return(uuid, text, text) to authenticated;
