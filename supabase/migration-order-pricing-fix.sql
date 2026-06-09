-- 주문 가격 드리프트 복구 + 최소금액 조정.
--   (1) 특수배송(제주·도서산간) 5,000원 복원, (2) 회원 단품 공휴일 발송일,
--   (3) 회당 최소금액 25,000 → 24,000원 (750mL 12,000원 × 2병 통과).
--   대상 함수: _create_once_order_core / create_once_order / create_subscription_order / request_renewal.
--
-- 문제(라이브 머니 버그, prod 진단으로 확정):
--   여러 마이그레이션이 같은 주문 함수를 각자 옛 사본 기준으로 재정의하며 서로의 추가분을 덮어써,
--   현재 단품(회원·게스트)·구독 모두 특수배송지역에 5,000원 대신 4,000원만 청구 중(과소청구).
--   + 회원 단품(create_once_order)은 독립본문이라 공휴일 발송일이 적용되지 않음.
--   (특수배송 5,000원은 현재 request_renewal 에만 남아 있었음.)
--
-- 해결(surgical): 함수 구조는 그대로 두고 각 함수의 배송비 계산만 특수배송 분기로 복원하고,
--   회원 단품의 발송일을 next_dispatch_date(공휴일 반영)로 교체하며, 회당 최소금액을 24,000원으로 낮춘다.
--   ※ 회원 단품은 현금영수증을 별도 set_cash_receipt RPC 로 처리하므로(코어와 구조가 다름)
--     코어 통합 대신 각 함수를 충실히 보존-수정한다(이중처리 회귀 방지).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행(모두 이미 prod 적용됨): is_special_delivery_postcode(special-delivery-region-v3),
--     next_dispatch_date(holiday-dispatch), apply_referral_credit(referral-credit-redeem).

-- 사전 점검: 의존 함수가 prod 에 있는지 즉시 확인(없으면 명확히 중단 — 런타임 침묵 실패 방지).
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
-- 1) _create_once_order_core (게스트 단품의 실체 + 회원 단품 코어 후보).
--    holiday-dispatch.sql 정의 그대로 보존 + v_shipping 특수배송 분기만 복원.
-- ───────────────────────────────────────────────────────────────────────────
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
  v_ship      date;
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

revoke all on function public._create_once_order_core(uuid, jsonb, jsonb) from public;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) create_once_order (회원 단품). referral-credit-redeem.sql 정의 그대로 보존 +
--    (a) v_shipping 특수배송 분기 복원, (b) 발송일을 next_dispatch_date(공휴일 반영)로 교체.
--    적립금 자동 선차감 블록은 그대로 유지.
-- ───────────────────────────────────────────────────────────────────────────
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

grant execute on function public.create_once_order(jsonb, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) create_subscription_order (구독). referral-credit-redeem.sql 정의 그대로 보존 +
--    v_shipping 특수배송 분기(×주수) 복원. 적립금 블록·슬롯 로직은 그대로 유지.
-- ───────────────────────────────────────────────────────────────────────────
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

grant execute on function public.create_subscription_order(jsonb, int, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) request_renewal (구독 연장). referral-credit-redeem.sql 정의 그대로 보존 +
--    회당 최소금액 25,000 → 24,000 만 변경(특수배송·적립금은 이미 보존돼 있던 그대로).
--    클라(RenewalForm)는 MIN_ORDER_KRW=24,000 으로 검증하므로 서버 백스톱도 일치시킨다.
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

  if v_per_delivery < 24000 then
    raise exception '회당 최소 상품 금액은 24,000원입니다.';
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

  -- 연장주문 자기 order_items (새 구성·요일·할인단가)
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

-- ───────── 수기 검증(적용 후 SQL Editor) ─────────
-- 1) 진단표 재실행 → 네 함수 모두 has_special_delivery = true 기대:
--    select p.proname,
--      position('is_special_delivery_postcode' in pg_get_functiondef(p.oid))>0 as has_special,
--      position('next_dispatch_date'           in pg_get_functiondef(p.oid))>0 as has_holiday
--    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in
--      ('_create_once_order_core','create_once_order','create_subscription_order');
--    → core·create_once_order: has_special & has_holiday 모두 true.
--      create_subscription_order: has_special true.
-- 2) 제주 우편번호로 단품 주문 생성 → orders.shipping_fee = 5000, total_amount 에 반영 확인.
-- 3) 일반 지역 주문 → shipping_fee = 4000 (회귀 없음).
-- 4) 회당 최소금액: 상품합계 24,000원 주문 통과 / 23,990원 거부 확인(단품·구독·연장 동일).
