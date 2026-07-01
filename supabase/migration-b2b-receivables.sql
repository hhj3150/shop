-- B2B 미수금·수금 관리. 청구(거래명세 스냅샷) − 입금 = 미수 잔액.
--
--   client_invoices: 특정 기간의 거래처 청구액을 '확정' 시점 값으로 스냅샷(단가 변동에 안전).
--     (client_id, period_from, period_to) 유니크 → 같은 기간 재확정은 upsert(덮어쓰기).
--   client_payments: 거래처 입금 기록.
--   미수 잔액 = Σ(청구 total) − Σ(입금 amount).
-- 적용: Supabase SQL Editor 에서 실행.

create table if not exists public.client_invoices (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  supply      integer not null default 0 check (supply >= 0),
  tax         integer not null default 0 check (tax >= 0),
  total       integer not null default 0 check (total >= 0),
  memo        text,
  created_at  timestamptz not null default now(),
  unique (client_id, period_from, period_to)
);
create index if not exists client_invoices_client_idx
  on public.client_invoices (client_id, created_at desc);
alter table public.client_invoices enable row level security;

drop policy if exists "client_invoices_select_admin" on public.client_invoices;
create policy "client_invoices_select_admin" on public.client_invoices
  for select using (public.is_admin());
drop policy if exists "client_invoices_insert_admin" on public.client_invoices;
create policy "client_invoices_insert_admin" on public.client_invoices
  for insert with check (public.is_admin());
drop policy if exists "client_invoices_update_admin" on public.client_invoices;
create policy "client_invoices_update_admin" on public.client_invoices
  for update using (public.is_admin());
drop policy if exists "client_invoices_delete_admin" on public.client_invoices;
create policy "client_invoices_delete_admin" on public.client_invoices
  for delete using (public.is_admin());

create table if not exists public.client_payments (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  paid_on     date not null,
  amount      integer not null check (amount >= 0),
  method      text,
  memo        text,
  created_at  timestamptz not null default now()
);
create index if not exists client_payments_client_idx
  on public.client_payments (client_id, paid_on desc);
alter table public.client_payments enable row level security;

drop policy if exists "client_payments_select_admin" on public.client_payments;
create policy "client_payments_select_admin" on public.client_payments
  for select using (public.is_admin());
drop policy if exists "client_payments_insert_admin" on public.client_payments;
create policy "client_payments_insert_admin" on public.client_payments
  for insert with check (public.is_admin());
drop policy if exists "client_payments_update_admin" on public.client_payments;
create policy "client_payments_update_admin" on public.client_payments
  for update using (public.is_admin());
drop policy if exists "client_payments_delete_admin" on public.client_payments;
create policy "client_payments_delete_admin" on public.client_payments
  for delete using (public.is_admin());
