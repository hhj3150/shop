-- 업계 소식 레이더 — 모더레이션(관리자 승인제) 전환.
--   기존: 수집 즉시 공개. 변경: 관리자가 '게시'한 글만 고객에게 공개, 삭제 가능.
--   수집(주간 자동 + 관리자 수동)은 그대로 → '대기' 상태로 쌓이고, 관리자가 검토 후 게시.
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

-- 1) 게시 여부 컬럼. 기본 비공개 → 기존 수집글도 모두 '대기'로 전환(관리자가 다시 승인해야 노출).
alter table public.news_radar
  add column if not exists published boolean not null default false;

-- 2) 공개 읽기 정책: 게시된 글만(고객/비로그인). 관리자는 별도 정책으로 전체 조회.
--    (Postgres 의 다중 permissive 정책은 OR 로 결합됨 → published OR is_admin())
drop policy if exists "news_radar_select_all" on public.news_radar;

drop policy if exists "news_radar_select_published" on public.news_radar;
create policy "news_radar_select_published" on public.news_radar
  for select using (published);

drop policy if exists "news_radar_select_admin" on public.news_radar;
create policy "news_radar_select_admin" on public.news_radar
  for select using (public.is_admin());

-- 3) 관리자: 게시/숨김 토글.
create or replace function public.news_radar_set_published(
  p_id        uuid,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  update public.news_radar set published = coalesce(p_published, false) where id = p_id;
  if not found then raise exception '소식을 찾을 수 없습니다.'; end if;
end;
$$;

grant execute on function public.news_radar_set_published(uuid, boolean) to authenticated;

-- 4) 관리자: 삭제(검색·수집된 것 중 빼고 싶은 글 제거).
create or replace function public.news_radar_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  delete from public.news_radar where id = p_id;
  if not found then raise exception '소식을 찾을 수 없습니다.'; end if;
end;
$$;

grant execute on function public.news_radar_delete(uuid) to authenticated;

-- ── 검증(선택) — 적용 후 확인 ──
--   select column_name from information_schema.columns
--     where table_name = 'news_radar' and column_name = 'published';
--   select proname from pg_proc
--     where proname in ('news_radar_set_published', 'news_radar_delete');
--   select policyname from pg_policies where tablename = 'news_radar';
