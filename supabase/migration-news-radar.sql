-- 업계 소식 레이더: 주 1회 외부 뉴스(A2·저지·헤이밀크·동물복지·저탄소 낙농)를
--   검색해 가장 연관성 높은 1건을 한글로 번역·요약해 저장한다(관리자 피드 + 고객 노출).
--   스케줄 함수가 secret 으로 insert, 공개 읽기(고객 노출).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.
--   ※ Vault 시크릿 'news_radar_secret' 생성 + Netlify env 'NEWS_RADAR_SECRET' 에 같은 값.

create table if not exists public.news_radar (
  id             uuid primary key default gen_random_uuid(),
  title_ko       text not null,        -- 한글 제목(번역)
  summary_ko     text not null,        -- 한글 요약(2~3문장)
  source_name    text,
  source_url     text not null unique, -- 원문 링크(중복 방지)
  original_title text,
  topic          text,                 -- 주제 키워드(A2·저지·헤이밀크·동물복지·저탄소)
  published_at   timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.news_radar enable row level security;

-- 고객 노출 — 공개 읽기.
drop policy if exists "news_radar_select_all" on public.news_radar;
create policy "news_radar_select_all" on public.news_radar for select using (true);

-- 스케줄 함수 전용 insert(secret 게이트). 같은 source_url 은 무시(null 반환).
create or replace function public.news_radar_insert(
  p_secret         text,
  p_title_ko       text,
  p_summary_ko     text,
  p_source_name    text,
  p_source_url     text,
  p_original_title text,
  p_topic          text,
  p_published_at   timestamptz
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
    (title_ko, summary_ko, source_name, source_url, original_title, topic, published_at)
  values
    (p_title_ko, p_summary_ko, nullif(p_source_name, ''), p_source_url,
     nullif(p_original_title, ''), nullif(p_topic, ''), p_published_at)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.news_radar_insert(text, text, text, text, text, text, text, timestamptz)
  to anon, authenticated;
