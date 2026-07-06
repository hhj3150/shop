-- 같은 요일 중복 구독 신청 가드: 유니크 인덱스 500 → 결제 전 친절한 안내.
--
-- 문제 (prod 진단으로 확정, 2026-07-06 09:53 KST 실사례):
--   이미 그 요일에 구독(신청/활성/대기)이 있는 회원이 체크아웃에서 같은 요일로
--   다시 정기구독을 신청하면 — 전형적으로 4주 블록 만료를 앞둔 재구매/연장 의도 —
--   create_subscription_order 가 슬롯을 무조건 insert 해
--   `duplicate key value violates unique constraint "subscription_slots_user_day_uniq"`
--   원문 그대로가 고객에게 노출되고 주문 전체가 실패한다(재시도해도 동일 → 이탈).
--   설계상 연장은 request_renewal(내 계정 → 구독 연장) 경로가 맞지만, 서버는
--   이 경우를 사전에 감지해 한국어로 안내해야 한다(원문 유니크 위반 노출 금지).
--
-- 수정 (외과적 2곳):
--   1) 단일 요일 검증 직후, 같은 요일 비해지 슬롯 존재 시 안내 예외를 던진다
--      (주문·품목 insert 전 — 부수효과 없이 조기 차단).
--   2) 슬롯 insert 를 unique_violation 핸들러로 감싼다 — 사전 검사와 insert 사이의
--      레이스(두 탭 동시 제출 등)에서도 같은 안내 예외로 변환한다.
--      (예외 발생 시 트랜잭션 전체 롤백 → 고아 주문 없음)
--
-- 본문 보존 기준: 2026-07-06 prod 실제 정의(pg_get_functiondef)를 그대로 보존하고
--   위 두 곳만 수정했다(#53 교훈 — 옛 사본 기준 재정의 금지).
--
-- 클라이언트 짝 변경: app/checkout/page.tsx 가 본인 슬롯을 조회해 제출 전에
--   같은 안내(연장 경로 링크 포함)를 배너로 띄우고 제출을 차단한다.
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행(단일 트랜잭션).

begin;

-- 사전 점검: 함수가 기대 시그니처로 존재하는지 확인(없으면 드리프트 — 중단).
do $$
begin
  if to_regprocedure('public.create_subscription_order(jsonb,integer,jsonb,text)') is null then
    raise exception '드리프트: create_subscription_order(jsonb,integer,jsonb,text) 없음 — prod 정의 확인 후 본 파일 갱신 필요';
  end if;
end $$;

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

  -- ★ 같은 요일 기존 구독(비해지) 가드: 한 회원은 요일별 슬롯 하나만
  --   (unique index subscription_slots_user_day_uniq, status<>'해지').
  --   여기서 미리 감지해 안내한다 — 없으면 슬롯 insert 에서 유니크 위반 원문이
  --   고객에게 그대로 노출된다(2026-07-06 prod 실사례: 만료 임박 재구매 시도).
  if exists (
    select 1 from public.subscription_slots
     where user_id = v_uid and delivery_day = v_days[1] and status <> '해지'
  ) then
    raise exception '이미 이 요일에 진행 중인 정기구독이 있어요. 구독을 이어가시려면 [내 계정 → 구독 연장]에서 신청해 주세요. 다른 요일로는 새로 신청하실 수 있습니다.';
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
    -- ★ 레이스 방어: 사전 가드~insert 사이에 같은 요일 슬롯이 생긴 경우(두 탭 동시 제출 등)
    --   유니크 위반 원문 대신 같은 안내 예외로 변환한다(전체 롤백 → 고아 주문 없음).
    begin
      insert into public.subscription_slots (user_id, delivery_day, status, order_id)
        values (v_uid, v_day, case when v_waitlisted then '대기' else '신청' end, v_order_id);
    exception when unique_violation then
      raise exception '이미 이 요일에 진행 중인 정기구독이 있어요. 구독을 이어가시려면 [내 계정 → 구독 연장]에서 신청해 주세요. 다른 요일로는 새로 신청하실 수 있습니다.';
    end;
    v_slots := v_slots || jsonb_build_object(
      'deliveryDay', v_day,
      'position',    case when v_waitlisted then v_waitlist + 1 else v_taken + 1 end,
      'waitlisted',  v_waitlisted
    );
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'slots', v_slots);
end;
$function$;

commit;

-- ── 검증(수동, SQL Editor) ──────────────────────────────────────
-- 사전: 월요일 비해지 슬롯을 가진 회원 세션(auth.uid()).
--
-- A. 같은 요일 재신청 → 안내 예외(유니크 위반 원문 아님):
--   select create_subscription_order(
--     '[{"product_id":"milk-750","delivery_day":"mon","qty":2}]'::jsonb, 1,
--     '{"name":"테스트","phone":"01000000000","address":"주소"}'::jsonb, null);
--   -- ERROR: 이미 이 요일에 진행 중인 정기구독이 있어요. …
--
-- B. 다른 요일 신청 → 정상 생성:
--   select create_subscription_order(
--     '[{"product_id":"milk-750","delivery_day":"tue","qty":2}]'::jsonb, 1,
--     '{"name":"테스트","phone":"01000000000","address":"주소"}'::jsonb, null);
--
-- C. 롤백 확인: A 실패 시 orders/order_items 에 잔여 행 없음:
--   select count(*) from orders where user_id = auth.uid() and status='입금대기';
