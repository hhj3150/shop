-- 주문 생성 멱등키 — 더블서밋 중복주문 방지.
--
-- 문제(검증됨): create_subscription_order / create_once_order / create_guest_once_order
--   세 RPC 모두 호출마다 gen_order_no()로 새 주문을 만든다. 클라 `busy` 가드는 느린
--   더블클릭만 막고, 빠른 더블탭(setState 전)·네트워크 재시도·PortOne 재진입은 중복주문을
--   만든다. 중복주문 = 중복 PayAction 등록·고객 혼란·슬롯 오점유.
--
-- 설계: 클라가 체크아웃당 1회 UUID(idempotency_key)를 만들어 재시도 시 같은 키를 재사용한다.
--   (1) orders.idempotency_key 컬럼 + 부분 유니크 인덱스(키가 있는 행만).
--   (2) 각 RPC 시작부에서 같은 키(회원은 +user_id)의 기존 주문을 찾으면 생성을 건너뛰고
--       동일 payload 를 반환한다.
--   (3) 동시 더블서밋 백스톱: orders insert 를 unique_violation 으로 감싸, 다른 트랜잭션이
--       먼저 같은 키로 만들었으면 그 주문을 재조회해 반환한다(원자적). → 동시 두 제출이 같은
--       주문을 받는다.
--
-- 함수 본문은 prod 실제 정의(#53 migration-order-pricing-fix, 게스트 래퍼는
--   migration-guest-checkout)를 그대로 보존하고 멱등 단락 + 키 저장만 추가한다.
--   ⚠ 적용 전 prod 확인 권장:
--     select pg_get_functiondef('public.create_once_order(jsonb,jsonb)'::regprocedure);
--   세 함수가 위 보존 기준과 다르면(드리프트) 본 파일을 prod 기준으로 갱신 후 적용할 것(#53 교훈).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행(전 과정 단일 트랜잭션).
--   선행(모두 prod 적용됨): is_special_delivery_postcode, next_dispatch_date, apply_referral_credit.

begin;

-- 사전 점검: 의존 함수가 prod 에 있는지 확인(없으면 명확히 중단).
do $$
begin
  if to_regprocedure('public.is_special_delivery_postcode(text)') is null then
    raise exception '선행 누락: is_special_delivery_postcode — migration-special-delivery-region-v3.sql 먼저 적용';
  end if;
  if to_regprocedure('public.next_dispatch_date(date)') is null then
    raise exception '선행 누락: next_dispatch_date — migration-holiday-dispatch.sql 먼저 적용';
  end if;
  if to_regprocedure('public.apply_referral_credit(uuid,int,uuid)') is null then
    raise exception '선행 누락: apply_referral_credit — migration-referral-credit-redeem.sql 먼저 적용';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 0) 스키마: 멱등키 컬럼(nullable, 백필 안전) + 부분 유니크 인덱스.
--    기존 주문은 key=null → 부분 인덱스가 무시하므로 충돌 없음.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key_uniq
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- 시그니처가 (인자 추가로) 바뀌므로 기존 정의를 먼저 제거한다.
--   (plpgsql 본문은 지연 바인딩이라 래퍼보다 코어를 먼저 지워도 무방.)
drop function if exists public.create_once_order(jsonb, jsonb);
drop function if exists public.create_guest_once_order(jsonb, jsonb);
drop function if exists public.create_subscription_order(jsonb, int, jsonb);
drop function if exists public._create_once_order_core(uuid, jsonb, jsonb);

-- ───────────────────────────────────────────────────────────────────────────
-- 1) _create_once_order_core (게스트 단품의 실체). pricing-fix 정의 보존 + 멱등.
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
  -- 배송비: 특수배송지역(제주·도서산간) 5,000원, 그 외 4,000원.
  v_shipping := case
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
  v_total := v_subtotal + v_shipping;

  -- 발송일: 주말 + 공휴일을 건너뛴 다음 영업일(KST).
  v_ship := public.next_dispatch_date(v_today);

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
  -- 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
      order_type, ship_date, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message,
      cash_receipt_type, cash_receipt_id, idempotency_key
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
      v_cash_type, v_cash_id, p_idempotency_key
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
-- 2) create_once_order (회원 단품). pricing-fix 정의 보존 + 멱등.
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
  -- 배송비: 특수배송지역(제주·도서산간) 5,000원, 그 외 4,000원.
  v_shipping := case
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end;
  v_total := v_subtotal + v_shipping;

  -- 발송일: 주말 + 공휴일을 건너뛴 다음 영업일(KST).
  v_ship := public.next_dispatch_date(v_today);

  -- 배송지 검증
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  v_order_no := public.gen_order_no();
  -- 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
      order_type, ship_date, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message, idempotency_key
    ) values (
      v_uid, v_order_no, v_total, v_shipping, false, 1,
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
      p_idempotency_key
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
-- 3) create_guest_once_order (게스트 단품). guest-checkout 정의 보존 + 키 전달.
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
-- 4-a) 헬퍼: 멱등 재진입 시 구독 슬롯을 원래 응답과 같은 형태로 재구성.
--      position 의미 보존: 비대기 슬롯은 같은 요일 '신청'·'활성' 중 자기 id 이하 개수,
--      대기 슬롯은 '대기' 중 자기 id 이하 개수. (create_subscription_order 보다 먼저 정의.)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._rebuild_subscription_slots(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('deliveryDay', t.delivery_day, 'position', t.pos, 'waitlisted', t.waitlisted)
           order by t.id
         ), '[]'::jsonb)
  from (
    select ss.id, ss.delivery_day, (ss.status = '대기') as waitlisted,
      (select count(*) from public.subscription_slots x
        where x.delivery_day = ss.delivery_day
          and (case when ss.status = '대기'
                    then x.status = '대기'
                    else x.status in ('신청','활성') end)
          and x.id <= ss.id) as pos
    from public.subscription_slots ss
    where ss.order_id = p_order_id
  ) t;
$$;

revoke all on function public._rebuild_subscription_slots(uuid) from public;

-- ───────────────────────────────────────────────────────────────────────────
-- 4-b) create_subscription_order (구독). pricing-fix 정의 보존 + 멱등.
--      재진입 시 슬롯은 subscription_slots 에서 재구성해 동일 형태로 반환한다.
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
  -- 배송비: 특수배송지역(제주·도서산간) 5,000원, 그 외 4,000원. 회차(주수)만큼 합산.
  v_shipping := (case
    when public.is_special_delivery_postcode(p_ship->>'postcode') then 5000
    else 4000
  end) * v_weeks;
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  -- 2) 배송지 검증(서버측)
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  -- 3) 주문 생성: 동시 더블서밋은 부분 유니크 인덱스가 원자적으로 막는다.
  begin
    insert into public.orders (
      user_id, order_no, total_amount, shipping_fee, has_subscription,
      block_weeks, period_months, order_type, depositor_name,
      ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
      is_gift, gifter_name, gift_message, idempotency_key
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
      case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end,
      p_idempotency_key
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

commit;

-- ───────── 수기 검증(적용 후 SQL Editor) ─────────
-- 1) 컬럼·인덱스:
--    select 1 from information_schema.columns where table_name='orders' and column_name='idempotency_key';
--    select indexname from pg_indexes where tablename='orders' and indexname='orders_idempotency_key_uniq';
-- 2) 같은 키 재호출 → 같은 order_no (단품·게스트·구독 각각):
--    select public.create_guest_once_order('[{"product_id":"<PID>","qty":2}]'::jsonb,
--      '{"name":"홍길동","phone":"01012345678","address":"서울시 ...","postcode":"06000"}'::jsonb,
--      'test-key-001');  -- 2회 실행 → order_no 동일, orders 1건만 증가.
-- 3) 키 없이(null) 호출 → 매번 새 주문(하위호환). 클라는 항상 키를 보내므로 평시 미사용.
