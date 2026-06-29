-- AI 컨시어지 대화 로그 — 고객이 무엇을 묻는지 쌓아 FAQ·GEO 콘텐츠 보강과 이탈 신호 포착에 쓴다.
--
-- 설계(보안·프라이버시):
--   - 직접 INSERT 정책은 두지 않는다 → SECURITY DEFINER RPC(log_assistant_turn)로만 적재.
--   - 조회는 관리자(is_admin)만. 본문은 길이 상한으로 잘라 과도 저장을 막는다.
--   - user_id 는 로그인 시 auth.uid()(아니면 null=익명). 민감정보는 저장하지 않는다.
--
-- 적용: Supabase SQL Editor 또는 마이그레이션으로 1회 실행(멱등).

create table if not exists public.assistant_logs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid references auth.users(id) on delete set null,
  session_id    text,                 -- 한 대화 세션 묶음(클라 생성). 없으면 null.
  user_message  text not null,        -- 고객의 질문(그 턴)
  assistant_reply text not null,      -- 어시스턴트 답변
  added_count   int not null default 0 -- 그 턴에 장바구니로 담은 품목 수(전환 신호)
);

create index if not exists assistant_logs_created_idx on public.assistant_logs (created_at desc);

alter table public.assistant_logs enable row level security;

-- 조회: 관리자만.
drop policy if exists assistant_logs_select_admin on public.assistant_logs;
create policy assistant_logs_select_admin on public.assistant_logs
  for select using (public.is_admin());
-- (INSERT/UPDATE/DELETE 정책 없음 → 클라이언트 직접 쓰기 불가. 적재는 아래 RPC 로만.)

-- 한 턴 적재 RPC. 공개 엔드포인트(어시스턴트)에서 호출하므로 anon 에도 실행을 허용하되,
--   본문 길이를 잘라 저장하고 빈 질문은 무시한다. user_id 는 토큰이 있으면 auth.uid().
create or replace function public.log_assistant_turn(
  p_user_message   text,
  p_assistant_reply text,
  p_added_count    int,
  p_session_id     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(p_user_message), '') = '' then return; end if;
  insert into public.assistant_logs (user_id, session_id, user_message, assistant_reply, added_count)
  values (
    auth.uid(),
    nullif(btrim(coalesce(p_session_id, '')), ''),
    left(p_user_message, 1000),
    left(coalesce(p_assistant_reply, ''), 2000),
    greatest(0, coalesce(p_added_count, 0))
  );
end;
$$;

grant execute on function public.log_assistant_turn(text, text, int, text) to anon, authenticated;
