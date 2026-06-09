-- 가입 트리거 하드닝: handle_new_user 의 캐스트를 방어적으로.
--
-- 문제: handle_new_user(AFTER INSERT on auth.users)가 raw_user_meta_data 의
--   marketing_consent(::boolean)·marketing_consent_at(::timestamptz)를 직접 캐스트한다.
--   정상 가입 폼은 안전한 값만 보내지만, 메타데이터가 비정상 경로로 깨진 값이면 캐스트 예외 →
--   AFTER INSERT 트리거 예외 → auth.users INSERT 트랜잭션 전체 롤백 → 가입 자체가 실패한다.
--
-- 해결: 캐스트 전에 형식을 검사해 잘못된 값은 안전한 기본값(false/null)으로 처리한다.
--   (migration-signup-profile-trigger.sql 의 정의 + 캐스트만 방어적으로 교체.)
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행: migration-signup-profile-trigger.sql.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consent_raw text := new.raw_user_meta_data ->> 'marketing_consent';
  v_at_raw      text := new.raw_user_meta_data ->> 'marketing_consent_at';
begin
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
    -- 방어적: 'true'/'false' 외에는 false 로(캐스트 예외 → 가입 롤백 방지).
    case when lower(coalesce(v_consent_raw, '')) = 'true' then true else false end,
    -- 방어적: ISO 날짜 형태(YYYY-MM-DD…)일 때만 캐스트, 아니면 null.
    case when v_at_raw ~ '^\d{4}-\d{2}-\d{2}' then v_at_raw::timestamptz else null end
  )
  on conflict (id) do nothing;  -- 멱등: 이미 프로필이 있으면 건너뛴다.

  return new;
end;
$$;

-- 트리거 자체는 migration-signup-profile-trigger.sql 에서 이미 생성됨(함수만 재정의하면 반영).
-- (참고) 적용 확인:
--   select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;  -- on_auth_user_created 존재
