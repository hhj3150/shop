-- 소식 레이더 — 펫 콘텐츠 게이트용 category 컬럼 + insert RPC 확장.
--   news_radar.category('human'|'pet', 기본 'human'). 공개 밴드는 앱에서 PET_CONTENT_ENABLED=false 일 때
--   category='pet' 를 제외해 노출하지 않는다(자동 수집도 펫 분야 제외). 관리자 수동 펫 검색·적재는 허용.
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.
--   ※ 선행: migration-news-radar.sql, migration-news-radar-moderation.sql, migration-news-radar-curation.sql.

-- 1) 카테고리 컬럼(기존 행은 모두 'human' 으로 백필).
alter table public.news_radar
  add column if not exists category text not null default 'human';

-- 2) secret 게이트 insert 에 p_category 추가(기본 'human' — 구버전 8-인자 호출도 그대로 동작).
--    기존 8-인자 시그니처는 제거하고 9-인자(끝에 p_category, 기본값) 단일 함수로 대체.
drop function if exists public.news_radar_insert(
  text, text, text, text, text, text, text, timestamptz
);

create or replace function public.news_radar_insert(
  p_secret         text,
  p_title_ko       text,
  p_summary_ko     text,
  p_source_name    text,
  p_source_url     text,
  p_original_title text,
  p_topic          text,
  p_published_at   timestamptz,
  p_category       text default 'human'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_id       uuid;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'news_radar_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.news_radar where source_url = p_source_url) then
    return null;
  end if;

  insert into public.news_radar
    (title_ko, summary_ko, source_name, source_url, original_title, topic, category, published_at)
  values
    (p_title_ko, p_summary_ko, nullif(p_source_name, ''), p_source_url,
     nullif(p_original_title, ''), nullif(p_topic, ''),
     coalesce(nullif(p_category, ''), 'human'), p_published_at)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.news_radar_insert(
  text, text, text, text, text, text, text, timestamptz, text
) to anon, authenticated;

-- 3) 관리자 적재 draft RPC 에 p_category 추가(기본 'human'). 기존 6-인자 버전 제거 후 7-인자로 대체.
drop function if exists public.news_radar_insert_draft(
  text, text, text, text, text, text
);

create or replace function public.news_radar_insert_draft(
  p_title_ko       text,
  p_summary_ko     text,
  p_source_name    text,
  p_source_url     text,
  p_original_title text,
  p_topic          text,
  p_category       text default 'human'
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
  if coalesce(p_title_ko, '') = '' or coalesce(p_source_url, '') = '' then
    raise exception '제목·원문 링크는 필수입니다.';
  end if;
  if exists (select 1 from public.news_radar where source_url = p_source_url) then
    return null; -- 중복 무시
  end if;

  insert into public.news_radar
    (title_ko, summary_ko, source_name, source_url, original_title, topic, category, published)
  values
    (p_title_ko, coalesce(p_summary_ko, ''), nullif(p_source_name, ''), p_source_url,
     nullif(p_original_title, ''), nullif(p_topic, ''),
     coalesce(nullif(p_category, ''), 'human'), false)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.news_radar_insert_draft(
  text, text, text, text, text, text, text
) to authenticated;

-- ── 검증(적용 후 확인) ──
--   select column_name from information_schema.columns
--     where table_name = 'news_radar' and column_name = 'category';
--   select proname, pronargs from pg_proc
--     where proname in ('news_radar_insert', 'news_radar_insert_draft');
--   -- news_radar_insert=9 인자, news_radar_insert_draft=7 인자 각 1행이어야 함.
