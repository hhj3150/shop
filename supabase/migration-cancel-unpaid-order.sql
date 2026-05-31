-- 구매 취소(입금 전 주문 취소) RPC 추가.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 효과: 회원이 '입금대기' 상태의 주문을 스스로 취소할 수 있다(환불 없음).
--       연결된 미시작 슬롯(신청/대기)은 '해지'로 바뀌어 선착순 자리가 즉시 반환된다.
-- 안전장치: 입금확인된 주문은 취소 불가(기존 cancel_subscription 해지·환불만 가능).

create or replace function public.cancel_unpaid_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select status into v_status
    from public.orders
   where id = p_order_id and user_id = v_uid
   for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  if v_status <> '입금대기' then
    raise exception '입금 전 주문만 취소할 수 있습니다. 이미 입금이 확인된 주문은 구독 해지·환불을 이용해 주세요.';
  end if;

  update public.subscription_slots
     set status        = '해지',
         cancel_reason  = '입금 전 구매 취소',
         cancelled_at   = v_today
   where order_id = p_order_id and user_id = v_uid and status in ('신청','대기');

  update public.orders set status = '취소' where id = p_order_id;
end;
$$;

grant execute on function public.cancel_unpaid_order(uuid) to authenticated;
