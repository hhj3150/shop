-- 거래처별 제품 납품 단가 (B2B 매출·정산). 거래처×제품별 단가를 저장해
--   b2b_demand(수량)과 곱하면 기간 납품 매출·거래명세서를 계산할 수 있다.
--
-- 배경: 기존 B2B는 '수량'만 있고 '금액'이 없어 매출·정산을 못 냈다. 거래처마다
--   납품 단가가 다르므로 (거래처, 제품) 단위로 단가를 둔다.
--
-- 적용: Supabase SQL Editor에 붙여넣고 실행.

create table if not exists public.client_prices (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  product_key text not null,
  unit_price  integer not null default 0 check (unit_price >= 0),
  updated_at  timestamptz not null default now(),
  unique (client_id, product_key)
);

alter table public.client_prices enable row level security;

drop policy if exists "client_prices_select_admin" on public.client_prices;
create policy "client_prices_select_admin" on public.client_prices
  for select using (public.is_admin());

drop policy if exists "client_prices_insert_admin" on public.client_prices;
create policy "client_prices_insert_admin" on public.client_prices
  for insert with check (public.is_admin());

drop policy if exists "client_prices_update_admin" on public.client_prices;
create policy "client_prices_update_admin" on public.client_prices
  for update using (public.is_admin());

drop policy if exists "client_prices_delete_admin" on public.client_prices;
create policy "client_prices_delete_admin" on public.client_prices
  for delete using (public.is_admin());
