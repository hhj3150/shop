-- 구독 연장(재입금으로 같은 슬롯 이어가기) 기능.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 효과:
--   1) subscription_slots.extended_weeks: 연장 입금확인 시마다 4회씩 누적.
--      총 배송 회차 = 원 주문 block_weeks + extended_weeks (기존 슬롯 유지 → 요일·자리 보존).
--   2) orders.renews_slot_id: 연장 주문이 어떤 슬롯을 잇는지 표시(NULL이면 일반 주문).
--   3) request_renewal: 회원이 활성 구독을 연장 신청 → 7% 재계산한 입금대기 주문 생성.
--   4) confirm_renewal_payment: 관리자가 연장 입금 확인 → 슬롯 회차 +4 (원자적).

alter table public.subscription_slots
  add column if not exists extended_weeks integer not null default 0;

alter table public.orders
  add column if not exists renews_slot_id bigint;

create or replace function public.request_renewal(p_slot_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_slot         record;
  v_src          record;
  v_rate         numeric;
  v_weeks        int := 4;
  v_item         record;
  v_price        int;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select * into v_slot
    from public.subscription_slots
   where id = p_slot_id and user_id = v_uid and status = '활성'
   for update;
  if not found then raise exception '연장할 수 있는 활성 구독이 아닙니다.'; end if;

  if exists (select 1 from public.orders
              where renews_slot_id = p_slot_id and status = '입금대기') then
    raise exception '이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.';
  end if;

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  v_rate := public.period_discount(1);

  for v_item in
    select oi.product_id, oi.qty from public.order_items oi where oi.order_id = v_src.id
  loop
    select price into v_price from public.product_catalog where id = v_item.product_id and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_item.qty;
    v_per_list     := v_per_list + v_price * v_item.qty;
  end loop;

  if v_per_delivery <= 0 then raise exception '연장할 품목이 없습니다.'; end if;
  v_shipping := (case when v_per_list >= 50000 then 0 else 4000 end) * v_weeks;
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, renews_slot_id
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, 1, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$$;

grant execute on function public.request_renewal(bigint) to authenticated;

create or replace function public.confirm_renewal_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot  bigint;
  v_weeks int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  select renews_slot_id, block_weeks into v_slot, v_weeks
    from public.orders where id = p_order_id for update;
  if v_slot is null then raise exception '연장 주문이 아닙니다.'; end if;

  update public.orders set status = '입금확인' where id = p_order_id;
  update public.subscription_slots
     set extended_weeks = extended_weeks + v_weeks
   where id = v_slot;
end;
$$;

grant execute on function public.confirm_renewal_payment(uuid) to authenticated;
