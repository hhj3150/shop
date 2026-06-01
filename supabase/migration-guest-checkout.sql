-- ─────────────────────────────────────────────────────────────
-- 비회원(게스트) 단품(1회) 구매 허용
--
--   기존에는 단품 주문도 로그인(auth.uid())이 필요했다. 이 마이그레이션은
--   로그인 없이도 단품 1회 구매가 가능하도록 한다. 정기구독은 회원 전용으로 유지한다.
--
--   설계 요점:
--     1) orders.user_id 를 nullable 로 완화(게스트 주문은 user_id = null).
--     2) create_once_order 의 본문을 _create_once_order_core(p_uid, …) 로 추출해
--        회원/게스트가 같은 권위 로직(금액·발송일 서버 재계산)을 공유한다.
--     3) create_once_order(회원) = auth.uid() 필수 → core 호출.
--        create_guest_once_order(게스트) = user_id null 로 core 호출, anon 에 허용.
--     4) 게스트는 RLS로 자기 주문을 조회할 수 없으므로(소유자 매칭 불가),
--        core 가 반환 JSON 에 total_amount 를 포함한다 → 결제창 금액은 이 값을 쓴다.
--     5) 현금영수증 발행정보는 게스트가 set_cash_receipt(로그인 필요)를 못 쓰므로
--        core 가 주문 생성 시점에 p_ship 안의 값으로 직접 기록한다(회원 경로는 기존대로
--        기본값 '발행안함' 으로 들어간 뒤 set_cash_receipt 로 덮어쓴다 — 동작 불변).
--
--   결제·입금확인 경로는 변경 없음: 웹훅(confirm_payment)은 order_no 기준이라
--   게스트 주문도 그대로 결제·입금확인·문자발송이 동작한다.
--
-- 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 게스트 주문 허용: user_id nullable.
alter table public.orders alter column user_id drop not null;

-- 2) 공통 코어: 회원/게스트 공용 단품 주문 생성.
--    p_uid 가 null 이면 게스트 주문. 금액·발송일은 서버 권위값으로 재계산한다.
create or replace function public._create_once_order_core(
  p_uid   uuid,
  p_items jsonb,   -- [{product_id, qty}, ...]
  p_ship  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal  int := 0;
  v_shipping  int;
  v_total     int;
  v_order_id  uuid;
  v_order_no  text;
  v_is_gift   boolean := coalesce((p_ship->>'isGift')::boolean, false);
  v_item      jsonb;
  v_pid       text;
  v_qty       int;
  v_price     int;
  v_name      text;
  v_volume    text;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
  v_dow       int;
  v_ship      date;
  -- 현금영수증(선택): 게스트는 별도 RPC를 못 쓰므로 주문 생성 시 함께 기록한다.
  v_cash_type text := coalesce(nullif(trim(coalesce(p_ship->>'cashReceiptType','')), ''), '발행안함');
  v_cash_id   text := nullif(regexp_replace(coalesce(p_ship->>'cashReceiptId',''), '[^0-9]', '', 'g'), '');
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '담은 제품이 없습니다.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select price into v_price from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  if v_subtotal < 25000 then
    raise exception '단품 최소 주문 금액은 25,000원입니다.';
  end if;
  v_shipping := 4000;  -- 배송비는 주문 금액과 무관하게 항상 자부담
  v_total := v_subtotal + v_shipping;

  v_dow := extract(dow from v_today)::int;  -- 0=일 … 6=토
  if v_dow = 6 then
    v_ship := v_today + 3;
  elsif v_dow = 0 then
    v_ship := v_today + 2;
  else
    v_ship := v_today + 1;
    if extract(dow from v_ship)::int = 6 then v_ship := v_ship + 2; end if;
  end if;

  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  -- 현금영수증 발행정보 검증(입력된 경우에만). 회원 경로는 p_ship 에 값이 없어 '발행안함'.
  if v_cash_type not in ('소득공제','지출증빙','발행안함') then
    raise exception '현금영수증 발행 방식이 올바르지 않습니다.';
  end if;
  if v_cash_type = '소득공제' and (v_cash_id is null or length(v_cash_id) < 10 or length(v_cash_id) > 11) then
    raise exception '소득공제용 휴대폰 번호를 정확히 입력해 주세요.';
  end if;
  if v_cash_type = '지출증빙' and (v_cash_id is null or length(v_cash_id) <> 10) then
    raise exception '지출증빙용 사업자등록번호 10자리를 정확히 입력해 주세요.';
  end if;
  if v_cash_type = '발행안함' then v_cash_id := null; end if;

  v_order_no := public.gen_order_no();
  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
    order_type, ship_date, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message,
    cash_receipt_type, cash_receipt_id
  ) values (
    p_uid, v_order_no, v_total, v_shipping, false, 1,
    '단품', v_ship,
    coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
    trim(p_ship->>'name'),
    regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
    nullif(trim(coalesce(p_ship->>'postcode','')),''),
    trim(p_ship->>'address'),
    nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
    nullif(trim(coalesce(p_ship->>'memo','')),''),
    v_is_gift,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end,
    v_cash_type, v_cash_id
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, null, v_qty, v_price);
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'ship_date', to_char(v_ship, 'YYYY-MM-DD'),
    'total_amount', v_total
  );
end;
$$;

-- 코어는 내부 헬퍼다. 외부(anon/authenticated)에서 직접 호출하지 못하게 막고,
-- 아래 래퍼(SECURITY DEFINER)만 호출하도록 한다.
revoke all on function public._create_once_order_core(uuid, jsonb, jsonb) from public;

-- 3) 회원용: 로그인 필수. 기존 동작 + 반환에 total_amount 추가(가산적, 하위호환).
create or replace function public.create_once_order(
  p_items jsonb,
  p_ship  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  return public._create_once_order_core(v_uid, p_items, p_ship);
end;
$$;

grant execute on function public.create_once_order(jsonb, jsonb) to authenticated;

-- 4) 게스트용: 로그인 없이 단품 1회 주문. user_id = null 로 생성.
create or replace function public.create_guest_once_order(
  p_items jsonb,
  p_ship  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._create_once_order_core(null, p_items, p_ship);
end;
$$;

grant execute on function public.create_guest_once_order(jsonb, jsonb) to anon, authenticated;
