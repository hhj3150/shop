-- 소식 레이더 — 검색·선별: 관리자가 검색 결과 후보를 '대기'로 적재하는 RPC.
--   기존 secret 게이트 insert(news_radar_insert)와 별개. is_admin 게이트, published=false.
--   같은 source_url 은 무시(null 반환).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

create or replace function public.news_radar_insert_draft(
  p_title_ko       text,
  p_summary_ko     text,
  p_source_name    text,
  p_source_url     text,
  p_original_title text,
  p_topic          text
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
    (title_ko, summary_ko, source_name, source_url, original_title, topic, published)
  values
    (p_title_ko, coalesce(p_summary_ko, ''), nullif(p_source_name, ''), p_source_url,
     nullif(p_original_title, ''), nullif(p_topic, ''), false)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.news_radar_insert_draft(text, text, text, text, text, text)
  to authenticated;

-- ── 검증(적용 후 확인) ──
--   select proname from pg_proc where proname = 'news_radar_insert_draft';
--   -- 비관리자 세션에서 호출 시 '관리자만 가능합니다.' 예외 확인.
