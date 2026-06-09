-- 편의성: Customer360 CS 메모(관리자 내부 응대 기록).
--
-- 문제: 고객 응대 중 알게 된 사항(민원 이력·배송 요청·특이사항)을 적어둘 곳이 없다.
--   profiles 에 컬럼을 두면 회원이 자기 행을 select 할 때 메모가 함께 노출된다
--   (RLS 는 행 단위라 컬럼을 가릴 수 없음) → 내부 메모가 고객에게 새어나갈 수 있다.
--
-- 해결: 별도 테이블 member_admin_notes 에 두고 is_admin() 전용 RLS 로 게이트한다.
--   회원 본인도 접근 불가. 관리자 UI 에서 관리자 토큰으로 직접 upsert(RLS 검증).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   미적용이어도 360 드로어는 그대로 동작한다(메모 로드/저장이 조용히 실패 → best-effort).

create table if not exists public.member_admin_notes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  memo       text,
  updated_at timestamptz not null default now()
);

alter table public.member_admin_notes enable row level security;

-- 관리자만 조회·작성·수정. 회원 본인 포함 비관리자는 일절 접근 불가(CS 내부 메모).
drop policy if exists member_admin_notes_admin_all on public.member_admin_notes;
create policy member_admin_notes_admin_all on public.member_admin_notes
  for all using (public.is_admin()) with check (public.is_admin());
