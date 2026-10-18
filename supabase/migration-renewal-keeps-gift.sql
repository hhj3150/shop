-- 연장주문이 '선물'이라는 사실을 잃지 않는다.
--
--   [무엇이 잘못됐었나]
--     request_renewal 이 연장주문을 만들 때 is_gift 를 false 로 박고,
--     gifter_name·gift_message 는 아예 복사하지 않았다. 배송지(ship_*)는 원주문에서
--     그대로 가져오므로 '받는 분 주소인데 선물이 아닌 주문'이 만들어진다.
--
--   [그래서 생기는 일]
--     ① 주소가 덮인다 — sync_my_order_shipping 은 `is_gift = false` 인 본인 주문을
--        전부 갱신한다. 구매자가 내 정보에서 주소를 고치면, 어머니께 가던 연장분이
--        구매자 집으로 바뀐다. 선물 플래그가 살아 있었다면 제외됐을 주문이다.
--        (2026-10 기준 아직 발생하지 않았으나 선물 연장 2건이 배송 중이라 노출돼 있었다)
--     ② 배송 화면에서 '선물 · 보낸이 OOO' 표시가 연장분부터 사라진다. 담당자가
--        보낸이와 받는이를 헷갈릴 여지가 생긴다.
--
--   [고치는 방법]
--     원주문의 is_gift·gifter_name·gift_message 를 그대로 승계한다. 배송지를 승계하는
--     것과 같은 이유다 — 연장은 같은 구독의 다음 블록이지 새 주문이 아니다.
--
--   ※ 입금 안내 문자가 받는 분에게 가던 문제는 이 함수가 아니라 알림 쪽에서 고쳤다
--     (lib/renewal-notify.ts). 선물 플래그에 기대지 않고 '연장 알림은 언제나 회원에게'로
--     둬서, 플래그가 또 누락되더라도 수신자는 틀리지 않는다.
create or replace function public.request_renewal(
  p_slot_id bigint, p_items jsonb, p_period integer, p_delivery_day text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid          uuid := auth.uid();
  v_slot         record;
  v_src          record;
  v_rate         numeric;
  v_weeks        int;
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_price        int;
  v_stock        int;
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_taken        int;
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

  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;

  if p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '연장할 품목이 없습니다.';
  end if;

  -- 배송지·예금주·선물 정보 승계용 원 구독 주문
  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    select price, name, volume, stock into v_price, v_name, v_volume, v_stock
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_list < 24000 then
    raise exception '회당 최소 상품 금액은 정가 기준 24,000원입니다.';
  end if;

  if p_delivery_day <> v_slot.delivery_day then
    if exists (select 1 from public.subscription_slots
                where user_id = v_uid and delivery_day = p_delivery_day and status <> '해지') then
      raise exception '이미 그 요일에 구독이 있어 요일을 변경할 수 없습니다.';
    end if;
    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = p_delivery_day;
    if v_taken >= 100 then
      raise exception '선택한 요일이 마감되어 변경할 수 없습니다.';
    end if;
  end if;

  v_shipping := case
    when v_src.delivery_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(v_src.ship_postcode) then 5000 else 4000 end) * v_weeks
  end;
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message, renews_slot_id, delivery_method
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    -- ★ 선물 정보 승계. false 로 박으면 '받는 분 주소인데 선물이 아닌 주문'이 되어
    --   sync_my_order_shipping 이 구매자 주소로 덮어쓴다.
    coalesce(v_src.is_gift, false), v_src.gifter_name, v_src.gift_message,
    p_slot_id, v_src.delivery_method
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := (v_item->>'qty')::int;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, p_delivery_day, v_qty, v_unit);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$function$;
