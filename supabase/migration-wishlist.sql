-- ─────────────────────────────────────────────────────────────
-- 찜하기(위시리스트)
--   상품 상세의 ♡ 버튼으로 회원이 제품을 찜해 두고, 내 계정에서 다시 본다.
--   product_id 는 카탈로그(lib/products·product_catalog)의 텍스트 id 를 그대로 쓴다
--   (FK 미설정 — 정적 카탈로그와 병행 운용 중이므로 앱단에서 해석).
-- 적용: Supabase SQL Editor 에서 한 번 실행. 멱등(재실행 안전).
-- ─────────────────────────────────────────────────────────────

create table if not exists public.wishlists (
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

alter table public.wishlists enable row level security;

-- 본인 것만 조회·추가·삭제(수정 불필요 — 토글은 insert/delete 로만).
drop policy if exists "wishlists_select_own" on public.wishlists;
create policy "wishlists_select_own" on public.wishlists
  for select using (auth.uid() = user_id);

drop policy if exists "wishlists_insert_own" on public.wishlists;
create policy "wishlists_insert_own" on public.wishlists
  for insert with check (auth.uid() = user_id);

drop policy if exists "wishlists_delete_own" on public.wishlists;
create policy "wishlists_delete_own" on public.wishlists
  for delete using (auth.uid() = user_id);
