-- 추천 적립금 — 사용 여부 선택(opt-out). 자동 선차감 정책은 유지하되, 고객이
--   체크아웃에서 '적립금 사용'을 끄면 방금 적용된 차감을 되돌린다(쿠폰을 아껴 다음에 사용).
--
-- 설계: 거대한 주문 RPC(create_subscription_order/create_once_order)는 건드리지 않는다.
--   주문 생성은 기존대로 자동 선차감하고, 클라이언트가 토글 OFF일 때만 이 함수를 호출해
--   '적용→원복'한다. 입금/결제 전(입금대기) 본인 주문만 대상이며, 멱등(이미 0이면 no-op)이다.
--
-- 동작:
--   1) 이 주문에 적용된 referral_rewards(applied) → earned 로 복구(applied_order_id 기준).
--   2) orders.total_amount 에 차감액을 더해 원복, referral_credit_krw = 0.
--   3) 복구한 금액(원) 반환. 되돌릴 게 없으면 0.
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   미적용 시 클라이언트의 revoke 호출이 조용히 실패(토글 OFF가 무시될 뿐, 결제·차감 자체는 안전).

create or replace function public.revoke_referral_credit(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_credit int;
begin
  -- 본인 주문이고 아직 입금/결제 전(입금대기)일 때만 되돌릴 수 있다.
  select referral_credit_krw into v_credit
    from public.orders
   where id = p_order_id and user_id = v_uid and status = '입금대기'
   for update;
  if v_credit is null or v_credit <= 0 then
    return 0;
  end if;

  -- 적용된 쿠폰을 이 주문 기준으로 earned 로 복구.
  update public.referral_rewards
     set status = 'earned', applied_at = null, applied_order_id = null
   where applied_order_id = p_order_id and status = 'applied';

  -- 주문 금액 원복(차감 전 금액으로).
  update public.orders
     set total_amount = total_amount + v_credit,
         referral_credit_krw = 0
   where id = p_order_id;

  return v_credit;
end;
$$;

grant execute on function public.revoke_referral_credit(uuid) to authenticated;
