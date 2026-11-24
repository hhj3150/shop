-- 연장분과 지금 기간을 서로 떼어 놓는다 (2026-11-24, 윤화영 거래처 사고)
--
-- ★ 무슨 일이 있었나
--   11/19 연장 입금이 PayAction 으로 자동 확인된 지 78초 뒤, 관리자가 '연장 주문' 행을 펼쳐
--   '구독 시작일 변경'을 눌렀다. 연장분이 언제 시작할지 정하려던 것이다. 그런데 그 버튼은
--   연장 주문이 아니라 원주문과 함께 쓰는 '구독 슬롯 하나'의 started_at 을 바꾼다.
--   앵커가 11/30 이후로 밀리자 지금 기간(12회 중 12번째)이 통째로 뒤로 밀려 11/23 명단에서
--   빠졌고, 회차는 1/36 부터 다시 셌다. 11/23 에 되돌린다고 다시 고쳤지만 9/14 로 들어가
--   (실제 첫 발송은 8/31) 원주문이 2회 더 나가고 연장분은 2주 늦게 시작할 상태였다.
--   (데이터는 11/24 에 8/31 로 복구하고 12회로 확정했다 — order_events 에 기록.)
--
--   또 손님이 연장 폼의 '받는 곳 바꾸기'로 주소를 고치면 sync_my_order_shipping 이 본인 주문
--   전부(지금 받는 배송 포함)를 덮어써, '연장분만 바꾸려 했는데 지금 배송까지 바뀌는' 일이 났다.
--
-- ★ 원칙: 지금 기간은 자기 정보·품목·요일·회차로 끝까지 가고, 연장분은 그 다음 회차부터
--   자기 정보로 이어진다. 연장분의 시작은 날짜가 아니라 '앞 기간이 끝난 다음 회차'다.
--
-- 이 파일
--   1) admin_set_slot_start — 시작일 변경을 서버에서 막고 기록한다.
--      이미 한 번이라도 나간(또는 회차를 확정한) 구독은 시작일을 바꿀 수 없다.
--      바꾸면 지난 회차까지 다시 셈해져 지금 기간이 밀린다. 쉬어 가기는 일시정지, 요일은 요일 변경.
--   2) request_renewal(+p_ship) — 연장분의 받는 곳을 따로 받는다(없으면 지금처럼 원주문에서 복사).
--      배송비(도서산간 여부)도 그 받는 곳 기준으로 계산한다.
--   3) set_my_renewal_ship_to — 아직 시작 전인 연장 주문 한 건의 받는 곳만 고친다.
--      지금 기간 주문은 건드리지 않는다. 도서산간 여부가 바뀌어 배송비가 달라지면 거절한다
--      (입금 금액이 PayAction 에 이미 등록돼 있어 금액을 바꿀 수 없다).

-- 1) 시작일 변경 ──────────────────────────────────────────────────────────────
create or replace function public.admin_set_slot_start(
  p_slot_id    bigint,
  p_new_start  date,
  p_new_first  date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slot    record;
  v_shipped int;
  v_daynum  int;
  v_first   date;
  v_method  text;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_new_start is null then raise exception '시작일을 선택해 주세요.'; end if;

  select * into v_slot from public.subscription_slots where id = p_slot_id for update;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;
  if v_slot.status = '해지' then raise exception '해지된 구독은 시작일을 바꿀 수 없습니다.'; end if;

  v_daynum := array_position(array['mon','tue','wed','thu','fri'], v_slot.delivery_day);
  if v_daynum is null or extract(isodow from p_new_start)::int <> v_daynum then
    raise exception '시작일이 이 구독의 배송 요일이 아닙니다.';
  end if;

  -- 원주문 + 연장주문 전체(슬롯 체인)에서 한 번이라도 나갔는지.
  select count(distinct sl.ship_date) into v_shipped
    from public.shipment_log sl
   where sl.order_id = v_slot.order_id
      or sl.order_id in (select r.id from public.orders r where r.renews_slot_id = p_slot_id);

  if v_shipped > 0 or v_slot.rounds_confirmed_count is not null then
    raise exception '이미 %회 나간 구독이라 시작일을 바꿀 수 없습니다. 시작일을 옮기면 지난 회차까지 다시 세어져 지금 기간이 뒤로 밀리고 배송 명단에서 빠집니다. 연장분은 지금 기간이 끝나면 다음 회차부터 저절로 이어집니다. 쉬어 가려면 일시정지, 요일은 요일 변경을 써 주세요.',
      greatest(v_shipped, coalesce(v_slot.rounds_confirmed_count, 0));
  end if;

  -- 방문수령은 출고 기록이 남지 않는다 — 이미 시작일이 지났으면 나간 것으로 본다.
  select delivery_method into v_method from public.orders where id = v_slot.order_id;
  if coalesce(v_method, '택배') = '방문수령'
     and v_slot.started_at is not null and v_slot.started_at <= public.kst_today() then
    raise exception '이미 시작된 방문수령 구독이라 시작일을 바꿀 수 없습니다(%부터 수령 중). 쉬어 가려면 일시정지, 요일은 요일 변경을 써 주세요.',
      to_char(v_slot.started_at, 'MM/DD');
  end if;

  v_first := case when p_new_first is null or p_new_first = p_new_start then null else p_new_first end;

  update public.subscription_slots
     set started_at = p_new_start, first_ship_date = v_first
   where id = p_slot_id;

  insert into public.order_events (order_id, event, reason, actor_id, meta)
  values (
    v_slot.order_id, 'start_changed',
    format('슬롯 %s 시작일 %s → %s', p_slot_id, coalesce(v_slot.started_at::text, '미시작'), p_new_start),
    auth.uid(),
    jsonb_build_object('slot_id', p_slot_id,
                       'before', v_slot.started_at, 'after', p_new_start,
                       'first_before', v_slot.first_ship_date, 'first_after', v_first,
                       'path', 'admin_set_slot_start')
  );

  return jsonb_build_object('slot_id', p_slot_id, 'started_at', p_new_start, 'first_ship_date', v_first);
end;
$$;

revoke all on function public.admin_set_slot_start(bigint, date, date) from public, anon;
grant execute on function public.admin_set_slot_start(bigint, date, date) to authenticated;

-- 받는 곳 입력 정리(이름·연락처·주소). 비면 null — 호출처가 거절한다.
create or replace function public._clean_ship_to(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case when p is null then null else jsonb_build_object(
    'name',           nullif(btrim(coalesce(p->>'name', '')), ''),
    'phone',          nullif(regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g'), ''),
    'postcode',       nullif(btrim(coalesce(p->>'postcode', '')), ''),
    'address',        nullif(btrim(coalesce(p->>'address', '')), ''),
    'address_detail', nullif(btrim(coalesce(p->>'address_detail', '')), '')
  ) end
$$;

-- 2) 연장 신청 — 연장분 받는 곳(p_ship)을 따로 받는다 ───────────────────────────
--   본문은 운영 DB 의 현재 정의(2026-11-24 pg_get_functiondef)에 p_ship 만 더했다.
--   p_ship 이 없으면 지금과 똑같이 원주문의 받는 곳을 복사한다.
drop function if exists public.request_renewal(bigint, jsonb, integer, text);

create or replace function public.request_renewal(
  p_slot_id bigint, p_items jsonb, p_period integer, p_delivery_day text, p_ship jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_ship         jsonb;
  v_ship_name    text;
  v_ship_phone   text;
  v_ship_post    text;
  v_ship_addr    text;
  v_ship_detail  text;
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

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  -- 받는 곳: 기본은 원주문 복사. 연장분만 다른 곳으로 받으려면 p_ship(택배일 때만).
  v_ship_name   := v_src.ship_name;
  v_ship_phone  := v_src.ship_phone;
  v_ship_post   := v_src.ship_postcode;
  v_ship_addr   := v_src.ship_address;
  v_ship_detail := v_src.ship_address_detail;
  v_ship := public._clean_ship_to(p_ship);
  if v_ship is not null and coalesce(v_src.delivery_method, '택배') <> '방문수령' then
    if v_ship->>'name' is null then raise exception '받는 분 이름을 입력해 주세요.'; end if;
    if length(coalesce(v_ship->>'phone', '')) < 10 then raise exception '받는 분 연락처를 정확히 입력해 주세요.'; end if;
    if v_ship->>'address' is null then raise exception '받는 곳 주소를 입력해 주세요.'; end if;
    v_ship_name   := v_ship->>'name';
    v_ship_phone  := v_ship->>'phone';
    v_ship_post   := v_ship->>'postcode';
    v_ship_addr   := v_ship->>'address';
    v_ship_detail := v_ship->>'address_detail';
  end if;

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

  -- 배송비는 연장분이 실제로 갈 곳(v_ship_post) 기준.
  v_shipping := case
    when v_src.delivery_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(v_ship_post) then 5000 else 4000 end) * v_weeks
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
    v_ship_name, v_ship_phone, v_ship_post,
    v_ship_addr, v_ship_detail, v_src.memo,
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
$$;

grant execute on function public.request_renewal(bigint, jsonb, integer, text, jsonb) to authenticated;

-- 3) 아직 시작 전인 연장 주문 한 건의 받는 곳만 고친다 ───────────────────────────
create or replace function public.set_my_renewal_ship_to(p_order_id uuid, p_ship jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_o    record;
  v_ship jsonb := public._clean_ship_to(p_ship);
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.user_id is distinct from v_uid then
    raise exception '본인 주문만 바꿀 수 있습니다.';
  end if;
  if v_o.renews_slot_id is null then
    raise exception '연장 주문이 아닙니다.';
  end if;
  if v_o.status not in ('입금대기', '입금확인') then
    raise exception '이미 배송이 시작된 연장분입니다. 받는 곳 변경은 고객센터로 말씀해 주세요.';
  end if;
  if exists (select 1 from public.shipment_log l where l.order_id = p_order_id) then
    raise exception '이미 배송이 시작된 연장분입니다. 받는 곳 변경은 고객센터로 말씀해 주세요.';
  end if;
  if coalesce(v_o.delivery_method, '택배') = '방문수령' then
    raise exception '방문수령 구독은 받는 곳이 없습니다.';
  end if;

  if v_ship is null or v_ship->>'name' is null then raise exception '받는 분 이름을 입력해 주세요.'; end if;
  if length(coalesce(v_ship->>'phone', '')) < 10 then raise exception '받는 분 연락처를 정확히 입력해 주세요.'; end if;
  if v_ship->>'address' is null then raise exception '받는 곳 주소를 입력해 주세요.'; end if;

  -- 도서산간 여부가 바뀌면 배송비가 달라진다. 입금 금액은 이미 정해져(PayAction 등록) 바꿀 수 없다.
  if public.is_special_delivery_postcode(v_o.ship_postcode)
     is distinct from public.is_special_delivery_postcode(v_ship->>'postcode') then
    raise exception '제주·도서산간 여부가 달라져 배송비가 바뀌는 주소입니다. %',
      case when v_o.status = '입금대기'
           then '연장 신청을 취소하고 새 주소로 다시 신청해 주세요.'
           else '고객센터로 말씀해 주세요.' end;
  end if;

  update public.orders
     set ship_name           = v_ship->>'name',
         ship_phone          = v_ship->>'phone',
         ship_postcode       = v_ship->>'postcode',
         ship_address        = v_ship->>'address',
         ship_address_detail = v_ship->>'address_detail'
   where id = p_order_id;

  insert into public.order_events (order_id, event, reason, actor_id, meta)
  values (p_order_id, 'renewal_ship_to_changed', '연장분 받는 곳 변경(지금 기간은 그대로)', v_uid,
          jsonb_build_object('before', jsonb_build_object(
                               'name', v_o.ship_name, 'postcode', v_o.ship_postcode,
                               'address', v_o.ship_address, 'address_detail', v_o.ship_address_detail),
                             'after', v_ship - 'phone'));

  return jsonb_build_object('order_id', p_order_id, 'ok', true);
end;
$$;

revoke all on function public.set_my_renewal_ship_to(uuid, jsonb) from public, anon;
grant execute on function public.set_my_renewal_ship_to(uuid, jsonb) to authenticated;
