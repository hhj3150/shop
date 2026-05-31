-- 출시 전 보안 패치: 권한 상승(self-admin) 차단
-- 문제: profiles_update_own / profiles_insert_own 정책이 컬럼을 제한하지 않아
--       일반 회원이 `update profiles set is_admin=true where id=auth.uid()` 로
--       스스로 관리자 권한을 획득할 수 있었다(전체 주문/회원 열람·입금확인 조작 가능).
-- 해결: is_admin 변경을 트리거로 차단. 관리자만 타 회원의 is_admin 을 바꿀 수 있다.
-- ★ Supabase SQL Editor 에서 반드시 1회 실행. (schema.sql 과 동일)

create or replace function public.protect_profile_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_admin, false) and not public.is_admin() then
      new.is_admin := false;
    end if;
    return new;
  end if;
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_admin on public.profiles;
create trigger trg_protect_profile_admin
  before insert or update on public.profiles
  for each row execute function public.protect_profile_admin();

-- (참고) 적용 확인:
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass;
-- 일반 계정으로 `update profiles set is_admin=true where id=auth.uid();` 실행 후
-- `select is_admin from profiles where id=auth.uid();` 가 여전히 false 면 정상.
