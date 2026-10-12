-- 퍼널 집계의 '하루'를 한국시간으로 자른다.
--
--   [문제] funnel_summary 는 timestamptz 인 created_at 을 date 인 p_from/p_to 와 바로
--     비교했다. date → timestamptz 변환은 세션 타임존(PostgREST 는 UTC)으로 일어나므로,
--     대시보드의 '하루'가 한국시간 09:00 ~ 다음날 09:00 이 됐다.
--     어젯밤 10시 방문이 오늘 칸에 잡히고, 오늘 새벽 방문도 오늘이 아닌 곳에 잡힌다.
--     숫자를 믿기 시작하는 순간부터 사람을 헷갈리게 한다.
--
--   [수정] 경계를 KST 자정으로 맞춘다.
--     `p_from::timestamp at time zone 'Asia/Seoul'` 은 순진한 타임스탬프(2026-09-24 00:00)를
--     '한국시간 그 시각'으로 해석해 timestamptz 를 돌려준다(= 2026-09-23 15:00+00).
--
--   ⚠ created_at 에 그대로 비교한다 — (created_at at time zone …)::date 로 감싸면
--     funnel_events_created_idx 를 못 쓴다. 이 표는 방문마다 쌓여 빠르게 커진다.
--
--   ※ AGENTS.md 규칙: 날짜 기준은 언제나 KST. kst_today() 와 같은 기준이다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: funnel_events 테이블 + funnel_summary(date,date).

do $$
begin
  if to_regclass('public.funnel_events') is null then
    raise exception '선행 누락: funnel_events — 퍼널 측정 마이그레이션 먼저 적용';
  end if;
  if to_regprocedure('public.funnel_summary(date,date)') is null then
    raise exception '선행 누락: funnel_summary(date,date)';
  end if;
end $$;


create or replace function public.funnel_summary(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_object_agg(event, cnt) into v
    from (
      select event, count(distinct session_id) as cnt
        from public.funnel_events
       -- KST 자정 ~ 다음날 KST 자정. created_at 을 감싸지 않아 인덱스를 쓴다.
       where created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
         and created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
       group by event
    ) t;

  return coalesce(v, '{}'::jsonb);
end;
$$;

grant execute on function public.funnel_summary(date, date) to authenticated;


-- 검증 (읽기만)
--   -- 경계가 KST 자정인가 — 오늘 09:00+09 가 아니라 00:00+09 여야 한다
--   select ('2026-09-24'::timestamp at time zone 'Asia/Seoul') as kst_midnight,
--          '2026-09-24'::date::timestamptz              as utc_midnight;
--   -- 본문에 Asia/Seoul 이 들어갔는가
--   select position('Asia/Seoul' in
--            pg_get_functiondef('public.funnel_summary(date,date)'::regprocedure)) > 0;
