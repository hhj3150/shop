-- 가입 데이터 유실 방지: 프로필 생성을 DB 트리거로 이전.
--
-- 문제: 기존 가입(app/signup)은 'session 이 있을 때'(이메일 확인 OFF)만 클라이언트에서
--       profiles 를 insert 했다. Supabase 이메일 확인을 켜면 가입 시 session 이 null 이라
--       이름·전화·주소·마케팅동의·추천코드가 영구 유실됐다(데이터 무결성이 운영 설정에 종속).
--
-- 해결: auth.users INSERT 시 트리거(handle_new_user)가 raw_user_meta_data 에서 프로필 필드를
--       읽어 public.profiles 를 생성한다. signUp({ options: { data } }) 로 메타데이터를 전달하면
--       이메일 확인 ON/OFF 와 무관하게 프로필이 안전하게 생성된다.
--       (추천 등록·환영 문자는 최초 로그인 시점에 클라이언트가 처리 — lib/post-signup.ts)
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행(트리거 생성은 owner 권한 필요).
--   선행: schema.sql(profiles + marketing_consent 컬럼), migration-prelaunch-security.sql
--         (protect_profile_admin — is_admin 권한상승 차단, 본 트리거와 충돌 없음) 적용 상태.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- raw_user_meta_data 에서 프로필 필드를 읽어 생성. name/phone 은 NOT NULL 이라
  -- 메타데이터 누락 시 빈 문자열로 대체(가입 자체가 막히지 않도록). 실제 가입 폼은 항상 채워 보낸다.
  insert into public.profiles (
    id, name, phone, postcode, address, address_detail,
    marketing_consent, marketing_consent_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'postcode', ''),
    nullif(new.raw_user_meta_data ->> 'address', ''),
    nullif(new.raw_user_meta_data ->> 'address_detail', ''),
    coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false),
    (new.raw_user_meta_data ->> 'marketing_consent_at')::timestamptz
  )
  on conflict (id) do nothing;  -- 멱등: 이미 프로필이 있으면(경합 등) 건너뛴다.

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- (참고) 적용 확인:
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;  -- on_auth_user_created 존재
--   가입 후: select id, name, phone, address from public.profiles where id = '<new-user-id>';
