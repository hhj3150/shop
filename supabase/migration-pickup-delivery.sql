-- 방문수령(pickup) 지원: delivery_method='방문수령'이면 배송비 0 + 주소 미요구.
-- 적용: Supabase SQL Editor 에 전체 붙여넣어 1회 실행(단일 트랜잭션).
-- ⚠ 적용 전 prod 실제 정의 확인(드리프트):
--   select pg_get_functiondef('public._create_once_order_core(uuid,jsonb,jsonb,text)'::regprocedure);
--   select pg_get_functiondef('public.create_once_order(jsonb,jsonb,text)'::regprocedure);
--   select pg_get_functiondef('public.create_subscription_order(jsonb,int,jsonb,text)'::regprocedure);
--   select pg_get_functiondef('public.request_renewal(bigint,jsonb,int,text)'::regprocedure);
--   repo 정의와 다르면 본 파일 본문을 prod 기준으로 맞춘 뒤 적용.
--
-- 본문 출처(라이브 최신):
--   - _create_once_order_core / create_once_order / create_guest_once_order /
--     create_subscription_order : migration-order-idempotency.sql
--   - request_renewal           : migration-renewal-modify.sql
-- 위 정의를 그대로 보존하고 (A) 수령방법 변수 (B) 배송비 0 (C) 주소검증 완화
--   (D) orders insert 에 delivery_method + 주소 NULL 처리 만 외과적으로 추가한다.
--   멱등 재진입·슬롯·적립금·현금영수증·발송일 로직은 100% 보존.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 0) 스키마: 수령방법 컬럼(기본 택배) + 주소 NOT NULL 완화.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists delivery_method text not null default '택배';
do $$ begin
  alter table public.orders
    add constraint orders_delivery_method_chk check (delivery_method in ('택배','방문수령'));
exception when duplicate_object then null; end $$;
alter table public.orders alter column ship_address drop not null;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) _create_once_order_core (게스트 단품의 실체). + 방문수령.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._create_once_order_core(
  p_uid             uuid,
  p_items           jsonb,   -- [{product_id, qty}, ...]
  p_ship            jsonb,
  p_idempotency_key text default null
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
  v_ship      date;
  v_cash_type text := coalesce(nullif(trim(coalesce(p_ship->>'cashReceiptType','')), ''), '발행안함');
  v_cash_id   text := nullif(regexp_replace(coalesce(p_ship->>'cashReceiptId',''), '[^0-9]', '', 'g'), '');
  v_method    text := case when (p_ship->>'deliveryMethod') = '방문수령' then '방문수령' else '택배' end;
begin
  -- 멱등: 같은 키로 이미 만든 주문이 있으면 그대로 반환(중복 생성 방지).
  if p_idempotency_key is not null then
    select id, order_no, ship_date, total_amount
      into v_order_id, v_order_no, v_ship, v_total
      from public.orders
     where idempotency_key = p_idempotency_key
       and user_id is not distinct from p_uid
     limit 1;
    if found then
      return jsonb_build_object(
        'order_id', v_order_id,
        'order_no', v_order_no,
        'ship_date', to_char(v_ship, 'YYYY-MM-DD'),
        'total_amount', v_total
      );
    end if;
  end if;

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

  if v_subtotal < 24000 then
    raise exception '단품 최소 주문 금액은 24,000원입니다.';
  end if;
  -- 배송비: 방문수령 0원, 특수배송지역(제주·도서산간) 5,000원, 그 외 4,000원.
  v_shipping := case
    when v_method = '방문수령' then 0
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
  v_total := v_subtotal + v_shipping;

  -- 발송일: 주말 + 공휴일을 건너뛴 다음 영업일(KST).
  v_ship := public.next_dispatch_date(v_today);

  -- 배송지 검증: 주소는 택배일 때만 필수(방문수령은 미요구).
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10
     or (v_method = '택배' and length(trim(coalesce(p_ship->>'address',''))) = 0) then
    raise exception '받는 분·연락처를 올바르게 입력해 주세요.';
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
  -- 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
      order_type, ship_date, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message,
      cash_receipt_type, cash_receipt_id, idempotency_key, delivery_method
    ) values (
      p_uid, v_order_no, v_total, v_shipping, false, 1,
      '단품', v_ship,
      coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
      trim(p_ship->>'name'),
      regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
      nullif(trim(coalesce(p_ship->>'postcode','')),''),
      nullif(trim(coalesce(p_ship->>'address','')),''),
      nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
      nullif(trim(coalesce(p_ship->>'memo','')),''),
      v_is_gift,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end,
      v_cash_type, v_cash_id, p_idempotency_key, v_method
    ) returning id into v_order_id;
  exception when unique_violation then
    -- 동시 더블서밋: 다른 트랜잭션이 같은 키로 먼저 생성함 → 그 주문을 반환.
    select id, order_no, ship_date, total_amount
      into v_order_id, v_order_no, v_ship, v_total
      from public.orders
     where idempotency_key = p_idempotency_key
       and user_id is not distinct from p_uid
     limit 1;
    if not found then raise; end if;  -- 키 충돌이 아니면(예: order_no) 원래 예외 전파.
    return jsonb_build_object(
      'order_id', v_order_id,
      'order_no', v_order_no,
      'ship_date', to_char(v_ship, 'YYYY-MM-DD'),
      'total_amount', v_total
    );
  end;

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

revoke all on function public._create_once_order_core(uuid, jsonb, jsonb, text) from public;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) create_once_order (회원 단품). + 방문수령.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.create_once_order(
  p_items           jsonb,   -- [{product_id, qty}, ...]
  p_ship            jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
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
  v_ship      date;
  v_credit    int := 0;
  v_method    text := case when (p_ship->>'deliveryMethod') = '방문수령' then '방문수령' else '택배' end;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  -- 멱등: 같은 키(+본인)로 이미 만든 주문이 있으면 그대로 반환. 금액은 클라가 재조회한다.
  if p_idempotency_key is not null then
    select id, order_no, ship_date
      into v_order_id, v_order_no, v_ship
      from public.orders
     where idempotency_key = p_idempotency_key and user_id = v_uid
     limit 1;
    if found then
      return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'ship_date', to_char(v_ship, 'YYYY-MM-DD'));
    end if;
  end if;

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

  if v_subtotal < 24000 then
    raise exception '단품 최소 주문 금액은 24,000원입니다.';
  end if;
  -- 배송비: 방문수령 0원, 특수배송지역(제주·도서산간) 5,000원, 그 외 4,000원.
  v_shipping := case
    when v_method = '방문수령' then 0
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
  v_total := v_subtotal + v_shipping;

  -- 발송일: 주말 + 공휴일을 건너뛴 다음 영업일(KST).
  v_ship := public.next_dispatch_date(v_today);

  -- 배송지 검증: 주소는 택배일 때만 필수(방문수령은 미요구).
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10
     or (v_method = '택배' and length(trim(coalesce(p_ship->>'address',''))) = 0) then
    raise exception '받는 분·연락처를 올바르게 입력해 주세요.';
  end if;

  v_order_no := public.gen_order_no();
  -- 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
      order_type, ship_date, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message, idempotency_key, delivery_method
    ) values (
      v_uid, v_order_no, v_total, v_shipping, false, 1,
      '단품', v_ship,
      coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
      trim(p_ship->>'name'),
      regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
      nullif(trim(coalesce(p_ship->>'postcode','')),''),
      nullif(trim(coalesce(p_ship->>'address','')),''),
      nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
      nullif(trim(coalesce(p_ship->>'memo','')),''),
      v_is_gift,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end,
      p_idempotency_key, v_method
    ) returning id into v_order_id;
  exception when unique_violation then
    select id, order_no, ship_date
      into v_order_id, v_order_no, v_ship
      from public.orders
     where idempotency_key = p_idempotency_key and user_id = v_uid
     limit 1;
    if not found then raise; end if;
    return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'ship_date', to_char(v_ship, 'YYYY-MM-DD'));
  end;

  -- ▼ 적립금 자동 선차감(주문 insert 직후, id 확보 상태)
  v_credit := public.apply_referral_credit(v_uid, v_total, v_order_id);
  if v_credit > 0 then
    update public.orders
       set total_amount = v_total - v_credit, referral_credit_krw = v_credit
     where id = v_order_id;
    v_total := v_total - v_credit;
  end if;
  -- ▲

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, null, v_qty, v_price);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'ship_date', to_char(v_ship, 'YYYY-MM-DD'));
end;
$$;

grant execute on function public.create_once_order(jsonb, jsonb, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) create_guest_once_order (게스트 단품). 본문 불변 — 코어에 위임만.
--    deliveryMethod 는 p_ship 안에 실려 코어로 그대로 전달된다.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.create_guest_once_order(
  p_items           jsonb,
  p_ship            jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._create_once_order_core(null, p_items, p_ship, p_idempotency_key);
end;
$$;

grant execute on function public.create_guest_once_order(jsonb, jsonb, text) to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) create_subscription_order (구독). + 방문수령.
--    재진입 시 슬롯은 subscription_slots 에서 재구성해 동일 형태로 반환한다.
--    (_rebuild_subscription_slots 헬퍼는 본 파일에서 재정의하지 않는다 — 라이브 그대로.)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.create_subscription_order(
  p_items           jsonb,   -- [{product_id, delivery_day, qty}, ...]
  p_period          int,     -- 1 | 3 | 6 | 12
  p_ship            jsonb,
  p_idempotency_key text default null
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
  v_per_delivery int := 0;   -- 회당 상품 합계(할인가)
  v_per_list     int := 0;   -- 회당 상품 합계(정가) — 무료배송 판정
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
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_days         text[];
  v_slots        jsonb := '[]'::jsonb;
  v_taken        int;
  v_waitlist     int;
  v_waitlisted   boolean;
  v_credit       int := 0;
  v_method       text := case when (p_ship->>'deliveryMethod') = '방문수령' then '방문수령' else '택배' end;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  -- 멱등: 같은 키(+본인)로 이미 만든 주문이 있으면 슬롯을 재구성해 그대로 반환.
  if p_idempotency_key is not null then
    select id, order_no into v_order_id, v_order_no
      from public.orders
     where idempotency_key = p_idempotency_key and user_id = v_uid
     limit 1;
    if found then
      v_slots := public._rebuild_subscription_slots(v_order_id);
      return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'slots', v_slots);
    end if;
  end if;

  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '장바구니가 비어 있습니다.';
  end if;

  -- 1) 합계 계산 — 가격은 DB(product_catalog)의 권위값만 사용.
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
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_delivery < 24000 then
    raise exception '회당 최소 상품 금액은 24,000원입니다.';
  end if;
  -- 배송비: 방문수령 0원, 그 외 특수배송지역(제주·도서산간) 5,000원·일반 4,000원을 회차(주수)만큼 합산.
  v_shipping := case
    when v_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000 else 4000 end) * v_weeks
  end;
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  -- 2) 배송지 검증(서버측): 주소는 택배일 때만 필수(방문수령은 미요구).
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10
     or (v_method = '택배' and length(trim(coalesce(p_ship->>'address',''))) = 0) then
    raise exception '받는 분·연락처를 올바르게 입력해 주세요.';
  end if;

  -- 3) 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription,
      block_weeks, period_months, order_type, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message, idempotency_key, delivery_method
    ) values (
      v_uid, v_order_no, v_total, v_shipping, true,
      v_weeks, p_period, '구독',
      coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
      trim(p_ship->>'name'),
      regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
      nullif(trim(coalesce(p_ship->>'postcode','')),''),
      nullif(trim(coalesce(p_ship->>'address','')),''),
      nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
      nullif(trim(coalesce(p_ship->>'memo','')),''),
      v_is_gift,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end,
      p_idempotency_key, v_method
    ) returning id into v_order_id;
  exception when unique_violation then
    select id, order_no into v_order_id, v_order_no
      from public.orders
     where idempotency_key = p_idempotency_key and user_id = v_uid
     limit 1;
    if not found then raise; end if;
    v_slots := public._rebuild_subscription_slots(v_order_id);
    return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'slots', v_slots);
  end;

  -- ▼ 적립금 자동 선차감(주문 insert 직후, id 확보 상태)
  v_credit := public.apply_referral_credit(v_uid, v_total, v_order_id);
  if v_credit > 0 then
    update public.orders
       set total_amount = v_total - v_credit, referral_credit_krw = v_credit
     where id = v_order_id;
    v_total := v_total - v_credit;
  end if;
  -- ▲

  -- 4) 품목 — 단가는 다시 DB 권위값으로 산출(클라이언트 단가 무시)
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

  -- 5) C3: 요일별 슬롯 — advisory lock 으로 카운트→삽입을 원자적으로.
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

grant execute on function public.create_subscription_order(jsonb, int, jsonb, text) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 5) request_renewal (연장). 원 주문(v_src)의 수령방법을 승계.
--    연장은 원 주문 배송지·우편번호를 승계하므로 v_src.delivery_method 로 배송비 판정.
--    배송지 검증·order_items 생성 등 나머지는 100% 보존.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.request_renewal(
  p_slot_id      bigint,
  p_items        jsonb,   -- [{product_id, qty}, ...]
  p_period       int,     -- 1 | 2 | 3 (= 4/8/12주)
  p_delivery_day text     -- 'mon'..'fri'
)
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
  v_weeks        int;
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_price        int;
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

  -- 본인·활성 슬롯 잠금
  select * into v_slot
    from public.subscription_slots
   where id = p_slot_id and user_id = v_uid and status = '활성'
   for update;
  if not found then raise exception '연장할 수 있는 활성 구독이 아닙니다.'; end if;

  -- 입금대기 연장 중복 거절
  if exists (select 1 from public.orders
              where renews_slot_id = p_slot_id and status = '입금대기') then
    raise exception '이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.';
  end if;

  -- 할인율(라이브 재사용) / 회차수 검증
  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;

  if p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '연장할 품목이 없습니다.';
  end if;

  -- 배송지·예금주 승계용 원 구독 주문
  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  -- 금액 재계산(서버 권위) — 회당 상품 합계
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_delivery < 25000 then
    raise exception '회당 최소 상품 금액은 25,000원입니다.';
  end if;

  -- 요일 변경 사전 검사(권고; 권위 검사는 confirm_renewal_payment 에서 advisory lock 아래 재검사)
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

  -- 배송비: 방문수령 0원, 그 외 특수배송지역 보존. 연장은 원 주문 배송지를 승계하므로 원 주문 기준 판별.
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
    is_gift, renews_slot_id, delivery_method
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id, v_src.delivery_method
  ) returning id into v_order_id;

  -- ★ 신규: 연장주문 자기 order_items (새 구성·요일·할인단가) — "다음 블록부터만" 의 핵심
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

grant execute on function public.request_renewal(bigint, jsonb, int, text) to authenticated;

commit;

-- ───────── 수기 검증(적용 후 SQL Editor) ─────────
-- 1) 컬럼·제약·NULL 완화:
--    select column_name, is_nullable, column_default
--      from information_schema.columns
--     where table_name='orders' and column_name in ('delivery_method','ship_address');
--    → delivery_method: is_nullable='NO', default '택배' / ship_address: is_nullable='YES'
--    select 1 from information_schema.table_constraints
--     where table_name='orders' and constraint_name='orders_delivery_method_chk';
--
-- 2) 방문수령 게스트 단품 → 배송비 0·주소 NULL (가격 ≥ 24,000원인 PID 사용):
--    select public.create_guest_once_order(
--      '[{"product_id":"<PID>","qty":2}]'::jsonb,
--      '{"name":"홍길동","phone":"01012345678","deliveryMethod":"방문수령"}'::jsonb,
--      'pk-test-1');
--    select shipping_fee, delivery_method, ship_address
--      from public.orders where idempotency_key='pk-test-1';
--    → shipping_fee=0, delivery_method='방문수령', ship_address is null
--
-- 3) 택배 경로 회귀 — 여전히 4,000원/5,000원 부과:
--    select public.create_guest_once_order(
--      '[{"product_id":"<PID>","qty":2}]'::jsonb,
--      '{"name":"홍길동","phone":"01012345678","address":"서울시 ...","postcode":"06000"}'::jsonb,
--      'pk-test-2');
--    → shipping_fee=4000(일반)·5000(제주·도서산간), delivery_method='택배'.
--
-- 4) (정리) 테스트 주문 삭제:
--    delete from public.order_items where order_id in
--      (select id from public.orders where idempotency_key in ('pk-test-1','pk-test-2'));
--    delete from public.orders where idempotency_key in ('pk-test-1','pk-test-2');
