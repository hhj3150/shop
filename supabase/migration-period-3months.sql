-- 정기구독 기간 개편: 6·12개월 폐지 → 1·2·3개월, 할인 상한 12%.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 효과: 신규 주문 RPC(create_subscription_order)가 period_discount()로
--       금액을 재계산하므로, 이 함수만 바꾸면 1/2/3 외 기간은 NULL→주문 거절.
-- 기존 주문(period_months=6/12)의 과거 기록은 그대로 보존된다(소급 변경 없음).

create or replace function public.period_discount(p_months int)
returns numeric
language sql
immutable
as $$
  select case p_months
    when 1 then 0.10
    when 2 then 0.11
    when 3 then 0.12
    else null
  end;
$$;
