-- 정기구독 회원 할인율 변경: 5% → 10%
-- period_discount(1) 만 바꾸면 신규 주문·연장(create_subscription_order·request_renewal)이
-- 모두 서버에서 10%로 재계산한다. 단가는 10원 단위 반올림(기존 로직 유지).
-- ★ Supabase SQL Editor 에서 1회 실행. (schema.sql 의 period_discount 와 동일)

create or replace function public.period_discount(p_months int)
returns numeric
language sql
immutable
as $$
  select case p_months
    when 1 then 0.10
    else null
  end;
$$;

-- (참고) 적용 확인:
--   select public.period_discount(1);   -- 0.10 이 나와야 정상
