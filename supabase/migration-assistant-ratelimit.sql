-- 고객응대 AI 공개 엔드포인트(/api/assistant) 남용·비용 방지용 레이트리밋.
--   서버리스(Netlify)는 인메모리 카운터가 불안정하므로 DB 고정창(fixed-window) 카운터를 쓴다.
--   anon 으로 호출하되 SECURITY DEFINER RPC 만 접근(테이블 직접 접근 차단).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.
--   ※ 고객 AI 키(OPENAI_API_KEY) 활성화 '전에' 적용 권장.

create table if not exists public.assistant_rate_limit (
  bucket_key   text primary key,        -- ip + '|' + 창번호
  ip           text not null,
  count        integer not null default 0,
  window_start timestamptz not null default now()
);

alter table public.assistant_rate_limit enable row level security;
-- 정책 없음 — 아래 SECURITY DEFINER RPC 만 기록/조회한다.

-- p_ip 의 현재 창(고정 p_window_seconds 초) 호출수를 1 증가시키고,
--   상한(p_limit) 이내면 true, 초과면 false 를 반환한다.
create or replace function public.assistant_rate_check(
  p_ip             text,
  p_limit          integer default 20,
  p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket bigint;
  v_key    text;
  v_count  integer;
begin
  v_bucket := floor(extract(epoch from now()) / greatest(p_window_seconds, 1));
  v_key := coalesce(nullif(p_ip, ''), 'unknown') || '|' || v_bucket::text;

  insert into public.assistant_rate_limit (bucket_key, ip, count, window_start)
       values (v_key, coalesce(nullif(p_ip, ''), 'unknown'), 1, now())
  on conflict (bucket_key) do update set count = public.assistant_rate_limit.count + 1
  returning count into v_count;

  -- 오래된 창은 확률적으로 청소(테이블 비대 방지).
  if random() < 0.02 then
    delete from public.assistant_rate_limit where window_start < now() - interval '1 hour';
  end if;

  return v_count <= greatest(p_limit, 1);
end;
$$;

grant execute on function public.assistant_rate_check(text, integer, integer) to anon, authenticated;
