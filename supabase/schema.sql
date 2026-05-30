-- 송영신목장 독립몰 — 자동이체 · 회원제 · 정기구독 전용 스키마
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

-- ───────────────────────────────────────────────────────────
-- 1-1. 관리자 판별 함수 (RLS 재귀 방지를 위해 SECURITY DEFINER).
--      profiles.is_admin = true 인 계정만 관리자.
--      관리자 지정: update public.profiles set is_admin = true where id = '<auth uid>';
--      ※ profiles 테이블이 먼저 존재해야 하므로 테이블 생성 뒤에 둔다.
-- ───────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

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

-- 관리자는 모든 회원 프로필 조회 가능 (물류·연락용).
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 2. 주문 (무통장입금 · 4주분 선입금)
--    status 흐름: 입금대기 → 입금확인 → 배송준비 → 배송중 → 배송완료 / 취소
--    상태가 배송준비·배송중·배송완료로 바뀌면 Phase 2에서 소비자에게 문자 발송.
-- ───────────────────────────────────────────────────────────
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  order_no      text not null unique,          -- 사람이 읽는 주문번호 (입금자 대조용)
  status        text not null default '입금대기'
                check (status in ('입금대기','입금확인','배송준비','배송중','배송완료','취소')),
  has_subscription boolean not null default true,
  block_weeks   integer not null default 4,    -- 한 번 입금 = 몇 주분 (주 1회 × block_weeks 회)
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

-- 단품(1회) 주문 지원 컬럼. order_type='단품'이면 구독 슬롯 없이 ship_date에 발송.
alter table public.orders
  add column if not exists order_type text not null default '구독'
    check (order_type in ('구독','단품')),
  add column if not exists ship_date date,
  add column if not exists shipping_fee integer not null default 0,
  -- 구독 기간(개월). 1/3/6/12 중 하나. 전체 기간분(주 1회 × 4주 × 개월)을 한 번에 입금.
  add column if not exists period_months integer not null default 1;

alter table public.orders enable row level security;

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert with check (auth.uid() = user_id);

-- 관리자는 모든 주문 조회/상태변경(자동이체 확인·배송 상태) 가능.
drop policy if exists "orders_select_admin" on public.orders;
create policy "orders_select_admin" on public.orders
  for select using (public.is_admin());

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin" on public.orders
  for update using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 3. 주문 품목 (정기구독 전용 · 매주 1회 고정, 요일은 월~금 택1)
-- ───────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   text not null,
  product_name text not null,
  volume       text not null,
  delivery_day text check (delivery_day in ('mon','tue','wed','thu','fri')), -- 단품은 null
  qty          integer not null check (qty > 0),
  unit_price   integer not null
);

-- 단품 주문 도입 전 생성된 테이블을 위해 NOT NULL 제약 해제(이미 nullable이면 무시됨).
alter table public.order_items alter column delivery_day drop not null;

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

-- 관리자는 모든 주문 품목 조회 가능 (요일별·제품별 수량 집계).
drop policy if exists "order_items_select_admin" on public.order_items;
create policy "order_items_select_admin" on public.order_items
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 4. 정기구독 슬롯 (요일별 선착순 100명 · 전체 500명)
--    100명이 차면 status='대기' 로 대기자 등록 → Phase 2에서 빈 자리 발생 시 문자 안내.
--    started_at = 구독 시작일 (장기구독 할인 산정: 6개월↑ 15%, 1년↑ 20%).
--    동시성(100명 정확 마감)은 Phase 2의 RPC/함수에서 보강.
-- ───────────────────────────────────────────────────────────
-- status:
--   신청 = 신청 완료, 자동이체 확인 대기 (정원 100 안에 자리 점유)
--   활성 = 자동이체 확인된 정회원 (자리 점유, started_at 부여 → 연차 할인 기준)
--   대기 = 정원 100 초과 대기자 (자리 미점유, 빈 자리 생기면 승급)
--   해지 = 해지됨
create table if not exists public.subscription_slots (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  delivery_day text not null check (delivery_day in ('mon','tue','wed','thu','fri')),
  status       text not null default '신청'
               check (status in ('신청','활성','대기','해지')),
  started_at   date,                         -- 활성 전환(첫 자동이체 확인) 시점 = 구독 연차 기준일
  order_id     uuid references public.orders (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 한 회원은 요일별로 하나의 슬롯만 점유.
create unique index if not exists subscription_slots_user_day_uniq
  on public.subscription_slots (user_id, delivery_day)
  where status <> '해지';

alter table public.subscription_slots enable row level security;

drop policy if exists "slots_select_own" on public.subscription_slots;
create policy "slots_select_own" on public.subscription_slots
  for select using (auth.uid() = user_id);

drop policy if exists "slots_insert_own" on public.subscription_slots;
create policy "slots_insert_own" on public.subscription_slots
  for insert with check (auth.uid() = user_id);

-- 관리자는 모든 슬롯(활성·대기자) 조회/변경 가능.
drop policy if exists "slots_select_admin" on public.subscription_slots;
create policy "slots_select_admin" on public.subscription_slots
  for select using (public.is_admin());

drop policy if exists "slots_update_admin" on public.subscription_slots;
create policy "slots_update_admin" on public.subscription_slots
  for update using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 5. 요일별 점유 현황 뷰 (집계 수치만 노출, 개인정보 없음, 정원 100/요일).
--    security_invoker=off(기본): 뷰 소유자(postgres) 권한으로 실행되어 RLS를
--    우회하므로, 미로그인 방문자도 전체 집계(잔여 인원)를 볼 수 있다.
--    taken = 신청+활성(정원 점유). 잔여 = 100 - taken. waitlist = 대기자 수.
-- ───────────────────────────────────────────────────────────
create or replace view public.subscription_day_count as
  with days as (
    select unnest(array['mon','tue','wed','thu','fri']) as delivery_day
  )
  select
    d.delivery_day,
    coalesce(count(s.id) filter (where s.status = '활성'), 0)::int as active,
    coalesce(count(s.id) filter (where s.status in ('신청','활성')), 0)::int as taken,
    coalesce(count(s.id) filter (where s.status = '대기'), 0)::int as waitlist,
    100 as capacity
  from days d
  left join public.subscription_slots s
    on s.delivery_day = d.delivery_day
  group by d.delivery_day;

-- 뷰는 익명(미로그인) 방문자도 잔여 수량을 볼 수 있어야 하므로 읽기 권한 부여.
grant select on public.subscription_day_count to anon, authenticated;

-- ───────────────────────────────────────────────────────────
-- 6. 소식 (관리자 공지 · 홈 게시)
--    관리자가 제목/본문/사진/유튜브 링크를 올리고 published=true 로 게시.
--    게시된 글은 누구나(미로그인 포함) 읽을 수 있다.
--    이미지는 storage 'news' 버킷에 업로드, cover_url 에 공개 URL 저장.
--    동영상은 youtube_id 만 저장하고 프론트에서 임베드.
-- ───────────────────────────────────────────────────────────
create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  cover_url   text,
  youtube_id  text,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.news enable row level security;

-- 게시된 소식은 누구나 읽기.
drop policy if exists "news_select_published" on public.news;
create policy "news_select_published" on public.news
  for select using (published = true);

-- 관리자는 미게시 초안 포함 전체 조회/작성/수정/삭제.
drop policy if exists "news_select_admin" on public.news;
create policy "news_select_admin" on public.news
  for select using (public.is_admin());

drop policy if exists "news_insert_admin" on public.news;
create policy "news_insert_admin" on public.news
  for insert with check (public.is_admin());

drop policy if exists "news_update_admin" on public.news;
create policy "news_update_admin" on public.news
  for update using (public.is_admin());

drop policy if exists "news_delete_admin" on public.news;
create policy "news_delete_admin" on public.news
  for delete using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 6-1. 소식 이미지 스토리지 버킷 (공개 읽기, 관리자만 업로드)
-- ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('news', 'news', true)
on conflict (id) do nothing;

drop policy if exists "news_obj_read" on storage.objects;
create policy "news_obj_read" on storage.objects
  for select using (bucket_id = 'news');

drop policy if exists "news_obj_insert" on storage.objects;
create policy "news_obj_insert" on storage.objects
  for insert with check (bucket_id = 'news' and public.is_admin());

drop policy if exists "news_obj_delete" on storage.objects;
create policy "news_obj_delete" on storage.objects
  for delete using (bucket_id = 'news' and public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 7. 구매평 (제품별 별점 후기)
--    로그인 회원이 제품별로 1~5점 별점 + 후기 작성.
--    후기는 누구나(미로그인 포함) 읽을 수 있고, 이름은 프론트에서 마스킹(하현제→하**).
--    author_name 은 작성 시점 회원 이름 스냅샷.
-- ───────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  product_id   text not null,
  author_name  text not null,
  rating       smallint not null check (rating between 1 and 5),
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists reviews_product_created_idx
  on public.reviews (product_id, created_at desc);

alter table public.reviews enable row level security;

-- 후기는 누구나 읽기.
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews
  for select using (true);

-- 로그인 회원은 본인 이름으로만 작성.
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = user_id);

-- 본인 후기 삭제.
drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete using (auth.uid() = user_id);

-- 관리자는 모든 후기 삭제(부적절 후기 정리).
drop policy if exists "reviews_delete_admin" on public.reviews;
create policy "reviews_delete_admin" on public.reviews
  for delete using (public.is_admin());
