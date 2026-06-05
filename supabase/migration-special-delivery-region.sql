-- ─────────────────────────────────────────────────────────────
-- 특수배송지역(제주·도서산간 등) 배송비 5,000원
--
--   당일/익일 신선 배송이 어려운 지역(제주 전역·울릉도 등)은 배송비를
--   일반 4,000원 대신 5,000원(정기구독은 회당 5,000원)으로 청구한다.
--   주문 화면에서는 "신선함이 생명" 경고 + 동의를 받는다(클라이언트).
--
--   ⚠ 동기화(중요): 판별 기준(우편번호 구간/목록)은 lib/regions.ts 의
--     isSpecialDeliveryPostcode() 와 반드시 동일하게 유지할 것.
--     한쪽만 바꾸면 화면 표시액과 실제 청구액이 달라진다.
--
--   패치 대상(외과적, 기존 본문 100% 보존 + 배송비 줄만 지역 분기):
--     0) is_special_delivery_postcode(text)        ← 신규 헬퍼
--     1) _create_once_order_core(uuid,jsonb,jsonb) ← 라이브: storefront-catalog-guard.sql
--     2) create_subscription_order(jsonb,int,jsonb)← 라이브: storefront-catalog-guard.sql
--   once/guest 래퍼(create_once_order / create_guest_once_order)는 코어를
--   호출만 하므로 건드리지 않는다.
--
-- 멱등: 전부 create or replace. 적용 전후 라이브 주문 흐름 무중단.
-- 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- ── 0) 특수배송지역 우편번호 판별 ─────────────────────────────
--    신우편번호 5자리 기준. 숫자 5자리가 아니면 false(일반 지역 → 과청구 방지).
create or replace function public.is_special_delivery_postcode(p_postcode text)
returns boolean
language sql
immutable
as $$
  select case
    when length(d) <> 5 then false
    -- 개별 도서 우편번호(편집 가능). lib/regions.ts 의 EXTRA_SPECIAL_POSTCODES 와 동기화:
    --   when d in ('23004','58800') then true
    else (d::int between 63000 and 63644)   -- 제주특별자치도 전역
      or (d::int between 40200 and 40240)    -- 경상북도 울릉군(울릉도·독도)
  end
  from (select regexp_replace(coalesce(p_postcode, ''), '[^0-9]', '', 'g')) as t(d);
$$;

-- ── 1) 단품(1회) 공통 코어: 회원/게스트 공용 ───────────────────
--    storefront-catalog-guard.sql 본문 보존 + 배송비 줄만 지역 분기로 교체.
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
  v_stock     int;
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
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과.
    select stock into v_stock from public.product_catalog where id = v_pid and active;
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  if v_subtotal < 25000 then
    raise exception '단품 최소 주문 금액은 25,000원입니다.';
  end if;
  -- 배송비는 항상 자부담. 제주·도서산간 등 특수배송지역은 5,000원.
  v_shipping := case
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
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

-- 코어는 내부 헬퍼다. 외부(anon/authenticated)에서 직접 호출하지 못하게 막는다.
revoke all on function public._create_once_order_core(uuid, jsonb, jsonb) from public;

-- ── 2) 정기구독 주문 ──────────────────────────────────────────
--    storefront-catalog-guard.sql 본문 보존 + 배송비 줄만 지역 분기로 교체.
create or replace function public.create_subscription_order(
  p_items  jsonb,   -- [{product_id, delivery_day, qty}, ...]
  p_period int,     -- 1 (1개월 고정)
  p_ship   jsonb    -- {name, phone, postcode, address, addressDetail, depositorName, memo, isGift, gifterName, giftMessage}
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_rate         numeric;
  v_weeks        int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
  v_is_gift      boolean := coalesce((p_ship->>'isGift')::boolean, false);
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_day          text;
  v_price        int;
  v_stock        int;
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_days         text[];
  v_slots        jsonb := '[]'::jsonb;
  v_taken        int;
  v_waitlist     int;
  v_waitlisted   boolean;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '장바구니가 비어 있습니다.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    v_day := v_item->>'delivery_day';
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    if v_day is null or v_day not in ('mon','tue','wed','thu','fri') then
      raise exception '배송 요일이 올바르지 않습니다.';
    end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과.
    select stock into v_stock from public.product_catalog where id = v_pid and active;
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_delivery < 25000 then
    raise exception '회당 최소 상품 금액은 25,000원입니다.';
  end if;
  -- 배송비는 항상 자부담. 제주·도서산간 등 특수배송지역은 회당 5,000원.
  v_shipping := (case
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end) * v_weeks;
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독',
    coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
    trim(p_ship->>'name'),
    regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
    nullif(trim(coalesce(p_ship->>'postcode','')),''),
    trim(p_ship->>'address'),
    nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
    nullif(trim(coalesce(p_ship->>'memo','')),''),
    v_is_gift,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := (v_item->>'qty')::int;
    v_day := v_item->>'delivery_day';
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, v_day, v_qty, v_unit);
  end loop;

  select array_agg(distinct (e->>'delivery_day')) into v_days
    from jsonb_array_elements(p_items) e;
  foreach v_day in array v_days loop
    perform pg_advisory_xact_lock(hashtext('slot_day:' || v_day));
    select count(*) filter (where status in ('신청','활성')),
           count(*) filter (where status = '대기')
      into v_taken, v_waitlist
      from public.subscription_slots
     where delivery_day = v_day;
    v_waitlisted := v_taken >= 100;
    insert into public.subscription_slots (user_id, delivery_day, status, order_id)
      values (v_uid, v_day, case when v_waitlisted then '대기' else '신청' end, v_order_id);
    v_slots := v_slots || jsonb_build_object(
      'deliveryDay', v_day,
      'position',    case when v_waitlisted then v_waitlist + 1 else v_taken + 1 end,
      'waitlisted',  v_waitlisted
    );
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'slots', v_slots);
end;
$$;

grant execute on function public.create_subscription_order(jsonb, int, jsonb) to authenticated;

-- ───────── 사장님 적용 절차 ─────────
-- 1) 위 전체를 Supabase SQL Editor 에서 한 번 실행.
-- 2) 판별 확인:
--      select public.is_special_delivery_postcode('63322');  -- 제주 → true
--      select public.is_special_delivery_postcode('40210');  -- 울릉 → true
--      select public.is_special_delivery_postcode('06236');  -- 서울 → false
-- 3) 테스트 주문으로 육안 검증(특수지역 vs 일반):
--    · 단품: 제주 주소면 shipping_fee = 5000, 일반은 4000.
--    · 구독(예: 4주): 제주면 v_shipping = 5000×4 = 20,000, 일반은 16,000.
-- ⚠ 참고: 정기구독 '갱신'(request_renewal) 경로의 배송비는 본 마이그레이션
--    범위 밖이다. 갱신분도 특수지역 5,000원으로 하려면 별도 결정·작업 필요.
