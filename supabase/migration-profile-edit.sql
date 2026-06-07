-- 회원 정보(연락처·주소) 수정 — 관리자 수정 권한 추가.
--   배경: 회원이 가입·주문 시 주소나 전화번호를 잘못 기재한 경우, 지금까지는
--         관리자가 그 회원의 프로필을 고칠 방법이 없었다(조회 정책만 존재).
--   변경: 관리자(is_admin()=true)가 모든 회원 프로필을 수정할 수 있는 RLS UPDATE
--         정책을 추가한다. 회원 본인 수정(profiles_update_own)은 이미 있으므로
--         그대로 둔다. is_admin 권한 변경은 기존 트리거(trg_protect_profile_admin)가
--         계속 지켜준다(관리자만 변경 가능).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

-- ── 검증(선택) — 적용 후 확인 ──
--   -- 관리자 계정으로 로그인한 세션에서 다른 회원의 연락처를 수정해 본다:
--   -- update public.profiles set phone = '01000000000' where id = '<대상 회원 uid>';
--   -- 일반 회원 세션에서는 본인 행만 수정되고 타인 행은 0 rows 로 막혀야 한다.
