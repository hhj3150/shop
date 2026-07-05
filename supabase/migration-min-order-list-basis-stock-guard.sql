-- 최소주문금액 '정가 기준' 통일 + 품절(stock=0) 서버 가드 복원.
--
-- 문제 1 (정책 불일치, prod 진단으로 확정):
--   migration-order-pricing-fix(#53)의 목표는 "회당 최소 25,000 → 24,000원
--   (750mL 12,000원 × 2병 통과)"였으나, create_subscription_order 는 할인가 합계
--   (v_per_delivery)와 24,000원을 비교해 750mL 2병이 4주(10%) 기준 21,600원으로
--   계산돼 여전히 차단된다(단품은 정가 기준이라 통과 — 경로 간 불일치).
--   request_renewal 은 아예 옛 기준(할인가 < 25,000)이 남아 있었다.
--   → 세 경로 모두 '정가(v_per_list) < 24,000' 기준으로 통일한다.
--
-- 문제 2 (라이브 회귀, prod 진단으로 확정):
--   migration-order-idempotency 가 storefront-catalog-guard 보다 늦게 적용되며
--   품절(stock=0) 차단 가드를 덮어써 prod 에서 유실됐다 — 관리자가 품절 처리해도
--   서버 RPC 가 주문을 생성한다. → 가격 조회에 stock 을 포함해 가드를 복원한다.
--   (stock IS NULL = 무제한 → 통과, stock = 0 = 품절 → 예외. catalog-guard 와 동일 규칙)
--
-- 본문 보존 기준: 2026-07-05 prod 실제 정의(pg_get_functiondef)를 그대로 보존하고
--   위 두 가지만 외과적으로 수정했다(#53 교훈 — 옛 사본 기준 재정의 금지).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행(단일 트랜잭션).

begin;

-- 사전 점검: 세 함수가 기대 시그니처로 존재하는지 확인(없으면 드리프트 — 중단).
do $$
begin
  if to_regprocedure('public._create_once_order_core(uuid,jsonb,jsonb,text)') is null then
    raise exception '드리프트: _create_once_order_core(uuid,jsonb,jsonb,text) 없음 — prod 정의 확인 후 본 파일 갱신 필요';
  end if;
  if to_regprocedure('public.create_subscription_order(jsonb,integer,jsonb,text)') is null then
    raise exception '드리프트: create_subscription_order(jsonb,integer,jsonb,text) 없음 — prod 정의 확인 후 본 파일 갱신 필요';
  end if;
  if to_regprocedure('public.request_renewal(bigint,jsonb,integer,text)') is null then
    raise exception '드리프트: request_renewal(bigint,jsonb,integer,text) 없음 — prod 정의 확인 후 본 파일 갱신 필요';
  end if;
end $$;

-- ── 1) 단품(1회) 공통 코어(회원/게스트 공용): 품절 가드 복원 ────────────────
CREATE OR REPLACE FUNCTION public._create_once_order_core(p_uid uuid, p_items jsonb, p_ship jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select price, stock into v_price, v_stock from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과. (catalog-guard 가드 복원)
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
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
$function$;

-- ── 2) 정기구독: 품절 가드 복원 + 최소금액 '정가' 기준 ────────────────────
CREATE OR REPLACE FUNCTION public.create_subscription_order(p_items jsonb, p_period integer, p_ship jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid          uuid := auth.uid();
  v_rate         numeric;
  v_weeks        int;
  v_per_delivery int := 0;   -- 회당 상품 합계(할인가)
  v_per_list     int := 0;   -- 회당 상품 합계(정가) — 최소주문금액 판정 기준
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
    select price, name, volume, stock into v_price, v_name, v_volume, v_stock
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과. (catalog-guard 가드 복원)
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  -- ★ 단일 배송요일 강제: 한 정기구독 주문은 한 요일만. 다요일 혼합은 요일별로 따로 신청해야
  --   회차 금액·배송비·배송 명단이 요일별로 바르게 잡힌다('1주문=1슬롯' 모델 보존).
  select array_agg(distinct (e->>'delivery_day')) into v_days
    from jsonb_array_elements(p_items) e;
  if coalesce(array_length(v_days, 1), 0) > 1 then
    raise exception '정기구독은 한 번에 한 배송 요일만 신청할 수 있습니다. 요일별로 따로 신청해 주세요.';
  end if;

  -- 최소주문금액은 단품과 동일하게 '정가' 기준(#53 의 원래 의도: 750mL 12,000원 × 2병 통과).
  --   할인가 기준이면 2병=21,600원(4주)이 되어 부당 차단된다.
  if v_per_list < 24000 then
    raise exception '회당 최소 상품 금액은 정가 기준 24,000원입니다.';
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
  --   (단일 요일 강제로 v_days 는 항상 원소 1개지만, 기존 구조를 그대로 보존한다.)
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
$function$;

-- ── 3) 구독 연장: 품절 가드 + 최소금액 '정가 24,000원' 기준(옛 25,000 할인가 기준 잔존 수정) ──
CREATE OR REPLACE FUNCTION public.request_renewal(p_slot_id bigint, p_items jsonb, p_period integer, p_delivery_day text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select price, name, volume, stock into v_price, v_name, v_volume, v_stock
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과. (신규 구독·단품과 동일 규칙)
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  -- 최소주문금액은 신규 구독·단품과 동일하게 '정가 24,000원' 기준으로 통일.
  --   (기존: 할인가 < 25,000 — 옛 기준 잔존으로 연장만 더 엄격했음)
  if v_per_list < 24000 then
    raise exception '회당 최소 상품 금액은 정가 기준 24,000원입니다.';
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
$function$;

-- ── 4) 회원 단품(create_once_order): 독립 본문이라(코어 미사용 — 현금영수증 구조 차이로
--       #53 에서 의도적으로 분리 유지) 별도로 품절 가드를 복원한다. ─────────────
CREATE OR REPLACE FUNCTION public.create_once_order(p_items jsonb, p_ship jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_stock     int;
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
    select price, stock into v_price, v_stock from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    -- 재고 0(품절) 차단. stock IS NULL = 무제한 → 통과. (catalog-guard 가드 복원)
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
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
$function$;

commit;
