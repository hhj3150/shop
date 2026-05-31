-- 정기구독 회원 할인율 변경: 7% → 5%
-- 주문 금액은 서버가 권위를 가지므로 이 함수를 반드시 적용해야 화면 금액과 일치한다.
-- create_subscription_order / request_renewal 가 이 함수로 회당 단가를 재계산한다.
-- Supabase SQL Editor에서 실행. (schema.sql 의 동일 변경과 일치)

create or replace function public.period_discount(p_months int)
returns numeric
language sql
immutable
as $$
  select case p_months
    when 1 then 0.05
    else null
  end;
$$;
