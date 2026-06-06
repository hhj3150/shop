-- 리뷰 개인정보 노출 차단 — 서버 측 마스킹.
--   기존: 공개 reviews 테이블을 클라이언트가 select("*") → 비로그인 포함 누구나
--         author_name(실명 전체)·user_id(auth UUID)를 네트워크 응답으로 받음.
--         마스킹은 화면 표시 단계에서만 적용되어 응답 원본엔 실명이 노출됨.
--   변경: SECURITY DEFINER RPC(list_reviews)로만 공개 조회. 서버에서 author_name 을
--         마스킹하고 user_id 를 응답에서 제외. 본인 여부는 is_mine(boolean)으로만 노출.
--         원본 reviews 테이블의 RLS·쓰기 정책은 그대로 유지(클라이언트가 select 만 안 함).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

-- 1) 이름 마스킹 함수. lib/reviews.ts 의 maskName 과 동일 규칙:
--    trim → 빈값이면 '회원', 1글자면 그대로, 그 외 첫 글자 + 나머지 길이만큼 '*'.
--    한글도 문자 단위로 처리하기 위해 char_length(바이트 아님)를 쓴다.
create or replace function public.mask_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p_name), '') = '' then '회원'
    when char_length(btrim(p_name)) <= 1 then btrim(p_name)
    else left(btrim(p_name), 1) || repeat('*', char_length(btrim(p_name)) - 1)
  end;
$$;

-- 2) 공개 후기 조회 RPC. p_product_id 가 null 이면 전체(소셜 프루프 집계용),
--    값이 있으면 해당 제품만. author_name 은 마스킹값, user_id 는 반환하지 않고
--    본인 여부만 is_mine 으로 노출(비로그인 → auth.uid() null → 항상 false).
create or replace function public.list_reviews(p_product_id text default null)
returns table (
  id          uuid,
  product_id  text,
  author_name text,
  rating      smallint,
  body        text,
  created_at  timestamptz,
  is_mine     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.product_id,
    public.mask_name(r.author_name) as author_name,
    r.rating,
    r.body,
    r.created_at,
    coalesce(r.user_id = auth.uid(), false) as is_mine
  from public.reviews r
  where p_product_id is null or r.product_id = p_product_id
  order by r.created_at desc;
$$;

-- 공개 조회이므로 비로그인(anon) 포함 실행 허용.
grant execute on function public.list_reviews(text) to anon, authenticated;

-- ── 검증(선택) — 적용 후 확인 ──
--   -- 마스킹·user_id 미노출 확인(author_name 이 '하**' 형태, 결과에 user_id 컬럼 없음):
--   -- 인자 없이 호출(기본 null = 전체). bare NULL 의 타입 모호성을 피하려면 list_reviews() 사용.
--   select * from public.list_reviews();
--   -- 마스킹 규칙 스폿 체크:
--   select public.mask_name('하현제');  -- → 하**
--   select public.mask_name('하');      -- → 하
--   select public.mask_name('   ');     -- → 회원
