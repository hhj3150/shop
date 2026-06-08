-- ─────────────────────────────────────────────────────────────
-- 추천 적립금 — Phase 2: 자동 선차감. additive·멱등.
--   apply_referral_credit(user, total, order_id):
--     유효(earned·미만료) 쿠폰을 오래된 것부터 floor(total/5000)장까지 applied 처리
--     (applied_order_id=order_id) 하고 차감액(장수×5000)을 돌려준다.
--   주문 RPC 3개에서 v_total 계산·주문 insert 후 호출 → total_amount 를 차감액만큼 줄이고
--   orders.referral_credit_krw 에 기록. 한도 내 차감만(payable≥0). 원자 처리(실패 시 롤백).
--   ⚠ 각 주문 RPC 는 현재 본문 verbatim 복제 + (선언 v_credit·차감 블록·반환 total) 외 변경 0.
--      복제 출처: create_subscription_order/create_once_order = migration-order-integrity.sql,
--                 request_renewal(4-인자) = schema.sql:512.
-- ─────────────────────────────────────────────────────────────

create or replace function public.apply_referral_credit(
  p_user uuid, p_total int, p_order_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fit   int := greatest(0, p_total / 5000);  -- floor: int 나눗셈
  v_ids   uuid[];
  v_count int;
begin
  -- 유효(earned·미만료) 쿠폰을 오래된 것부터 최대 v_fit 장 잠금 선택.
  select array_agg(id) into v_ids from (
    select id from public.referral_rewards
     where user_id = p_user and status = 'earned'
       and (expires_at is null or expires_at > now())
     order by created_at asc
     limit v_fit
     for update skip locked
  ) s;
  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then return 0; end if;
  update public.referral_rewards
     set status = 'applied', applied_at = now(), applied_order_id = p_order_id
   where id = any(v_ids);
  return v_count * 5000;
end;
$$;
grant execute on function public.apply_referral_credit(uuid, int, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1) create_subscription_order — 구독 주문. (출처: migration-order-integrity.sql)
--    추가: 선언 v_credit, 주문 insert 직후 차감 블록. 그 외 본문 동일.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_subscription_order(
  p_items  jsonb,   -- [{product_id, delivery_day, qty}, ...]
  p_period int,     -- 1 | 3 | 6 | 12
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

  if v_per_delivery < 25000 then
    raise exception '회당 최소 상품 금액은 25,000원입니다.';
  end if;
  v_shipping := 4000 * v_weeks;  -- 현행 정책: 배송비는 주문 금액과 무관하게 항상 자부담
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  -- 2) 배송지 검증(서버측)
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  -- 3) 주문 생성
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

-- ─────────────────────────────────────────────────────────────
-- 2) create_once_order — 단품 주문. (출처: migration-order-integrity.sql)
--    추가: 선언 v_credit, 주문 insert 직후 차감 블록. 그 외 본문 동일.
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_once_order(
  p_items jsonb,   -- [{product_id, qty}, ...]
  p_ship  jsonb
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
  v_dow       int;
  v_ship      date;
  v_credit    int := 0;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
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
  v_shipping := 4000;  -- 현행 정책: 배송비는 주문 금액과 무관하게 항상 자부담
  v_total := v_subtotal + v_shipping;

  -- 발송일(월–금, KST): 토→화, 일→화, 평일→익일(금요일분은 다음 주 월요일)
  v_dow := extract(dow from v_today)::int;  -- 0=일 … 6=토
  if v_dow = 6 then
    v_ship := v_today + 3;
  elsif v_dow = 0 then
    v_ship := v_today + 2;
  else
    v_ship := v_today + 1;
    if extract(dow from v_ship)::int = 6 then v_ship := v_ship + 2; end if;
  end if;

  -- 배송지 검증
  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  v_order_no := public.gen_order_no();
  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
    order_type, ship_date, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message
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
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end
  ) returning id into v_order_id;

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

-- ─────────────────────────────────────────────────────────────
-- 3) request_renewal — 구독 연장 주문. (출처: schema.sql:512, 4-인자 live 버전)
--    추가: 선언 v_credit, 주문 insert 직후 차감 블록. 반환 total 은 차감 후 v_total.
-- ─────────────────────────────────────────────────────────────
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
  v_credit       int := 0;
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

  -- 배송비(특수배송지역 보존). 연장은 원 주문 배송지를 승계하므로 원 주문 우편번호로 판별.
  v_shipping := (case
    when public.is_special_delivery_postcode(v_src.ship_postcode) then 5000
    else 4000
  end) * v_weeks;
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, renews_slot_id
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  -- ▼ 적립금 자동 선차감(주문 insert 직후, id 확보 상태). 반환 total 도 차감 반영.
  v_credit := public.apply_referral_credit(v_uid, v_total, v_order_id);
  if v_credit > 0 then
    update public.orders
       set total_amount = v_total - v_credit, referral_credit_krw = v_credit
     where id = v_order_id;
    v_total := v_total - v_credit;
  end if;
  -- ▲

  -- ★ 신규: 연장주문 자기 order_items (새 구성·요일·할인단가)
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

-- ───────── 수기 검증(적용 후 SQL Editor 에서) ─────────
--   적립금 보유 회원으로 각 경로 주문 생성 후:
--   (구독) select total_amount, referral_credit_krw from orders order by created_at desc limit 1;
--          -- total_amount 가 5,000 단위로 줄고 referral_credit_krw = 차감액
--   (단품) 동일 확인.
--   (갱신) request_renewal 반환 total 이 차감 후 값인지 + orders 동일 확인.
--   쿠폰:  select status, applied_order_id from referral_rewards where user_id = '<uid>';
--          -- 차감된 N장이 'applied' + applied_order_id = 그 주문 id.
--   한도:  잔액 < 입금액인 회원은 payable>0(total_amount>0), 차감은 floor(total/5000) 한도 내.
