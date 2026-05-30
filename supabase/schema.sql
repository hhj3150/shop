-- 송영신목장 독립몰 — 무통장입금 · 회원제 스키마 (Phase 1)
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- 인증(이메일/비밀번호)은 Supabase Auth(auth.users)가 담당합니다.

-- ───────────────────────────────────────────────────────────
-- 1. 회원 프로필 (배송·문자 발송에 필요한 최소 정보)
-- ───────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null,
  phone        text not null,            -- 문자 발송용 (010xxxxxxxx)
  postcode     text,
  address      text,                     -- 기본 주소
  address_detail text,                   -- 상세 주소
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 본인 프로필만 조회/수정. 관리자는 Phase 2에서 service role로 접근.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- ───────────────────────────────────────────────────────────
-- 2. 주문 (무통장입금)
--    status 흐름: 입금대기 → 입금확인 → 출고준비 → 출고완료 / 취소
-- ───────────────────────────────────────────────────────────
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  order_no      text not null unique,          -- 사람이 읽는 주문번호 (입금자 대조용)
  status        text not null default '입금대기'
                check (status in ('입금대기','입금확인','출고준비','출고완료','취소')),
  has_subscription boolean not null default false,
  depositor_name text,                          -- 입금자명 (통장 대조용)
  total_amount  integer not null,
  -- 배송지 스냅샷 (주문 시점 정보 보존)
  ship_name     text not null,
  ship_phone    text not null,
  ship_postcode text,
  ship_address  text not null,
  ship_address_detail text,
  memo          text,
  created_at    timestamptz not null default now()
);

alter table public.orders enable row level security;

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert with check (auth.uid() = user_id);

-- 입금확인·출고 등 상태 변경은 관리자(Phase 2, service role)만. 회원 update 정책 없음.

-- ───────────────────────────────────────────────────────────
-- 3. 주문 품목
-- ───────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   text not null,
  product_name text not null,
  volume       text not null,
  mode         text not null check (mode in ('one','sub')),
  frequency    text check (frequency in ('weekly','biweekly','every4')),
  delivery_day text check (delivery_day in ('tue','thu')),
  qty          integer not null check (qty > 0),
  unit_price   integer not null
);

alter table public.order_items enable row level security;

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

drop policy if exists "order_items_insert_own" on public.order_items;
create policy "order_items_insert_own" on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────
-- 4. 정기구독 선착순 1000명 카운터 (Phase 2 발급 로직에서 사용)
--    슬롯 점유를 한 행으로 관리. 동시성은 Phase 2에서 RPC/함수로 보강.
-- ───────────────────────────────────────────────────────────
create table if not exists public.subscription_slots (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.subscription_slots enable row level security;

drop policy if exists "slots_select_own" on public.subscription_slots;
create policy "slots_select_own" on public.subscription_slots
  for select using (auth.uid() = user_id);

-- 선착순 잔여 슬롯 조회용 뷰 (공개 카운트만 노출).
create or replace view public.subscription_slot_count as
  select count(*)::int as taken, 1000 as capacity
  from public.subscription_slots;
