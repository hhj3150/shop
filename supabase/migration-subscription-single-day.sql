-- 정기구독 1주문 = 1배송요일 강제(다요일 합산 주문 차단).
--
-- 배경(버그): 한 장바구니에 서로 다른 배송 요일(예: 월·수)을 담아 정기구독을 신청하면,
--   ① 회당 금액이 요일 구분 없이 합산돼 "요일별 회차 24,000원" 의도가 한 주문으로 뭉개지고,
--   ② 한 주문(order_id)에 슬롯이 2개 매달려, 배송 명단 빌더(lib/roster-maps.ts)의
--      slotByOrder / slotIdByOrder(= order_id 키 Map)에서 두 번째 슬롯이 첫 번째를 덮어써
--      한 요일이 배송 명단에서 사라진다(배송 누락).
--   전체 구독·환불·연장·로스터 모델이 '1주문=1슬롯(1요일)' 을 전제하므로, 다요일 합산 주문
--   자체를 금지하고 요일별로 따로 신청하도록 막는 것이 근본 해결이다.
--
-- 적용: Supabase SQL Editor 에 전체 붙여넣어 1회 실행(단일 트랜잭션).
-- ⚠ 적용 전 prod 실제 정의 확인(드리프트):
--   select pg_get_functiondef('public.create_subscription_order(jsonb,int,jsonb,text)'::regprocedure);
--   repo 정의와 다르면 본 파일 본문을 prod 기준으로 맞춘 뒤 적용.
--
-- 본문 출처(라이브 최신): migration-pickup-delivery.sql.
--   위 정의를 그대로 보존하고, (★) 합계 계산 직후 '단일 배송요일' 검증만 외과적으로 추가한다.
--   멱등 재진입·슬롯·적립금·현금영수증·배송비·발송일 로직은 100% 보존.

begin;

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

  -- ★ 단일 배송요일 강제: 한 정기구독 주문은 한 요일만. 다요일 혼합은 요일별로 따로 신청해야
  --   회차 금액·배송비·배송 명단이 요일별로 바르게 잡힌다('1주문=1슬롯' 모델 보존).
  select array_agg(distinct (e->>'delivery_day')) into v_days
    from jsonb_array_elements(p_items) e;
  if coalesce(array_length(v_days, 1), 0) > 1 then
    raise exception '정기구독은 한 번에 한 배송 요일만 신청할 수 있습니다. 요일별로 따로 신청해 주세요.';
  end if;

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
$$;

grant execute on function public.create_subscription_order(jsonb, int, jsonb, text) to authenticated;

commit;
