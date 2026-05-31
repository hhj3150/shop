-- ───────────────────────────────────────────────────────────
-- 결제 무결성 마이그레이션 (C1·C2·C3)
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- 이미 schema.sql 을 실행한 DB에 "추가로" 적용하는 델타입니다. 멱등(여러 번 실행 가능).
--
-- 목적:
--   C1) 주문 금액을 브라우저가 아닌 서버(DB)에서 권위 있게 재계산한다.
--       - 가격은 product_catalog 테이블이 유일한 출처.
--       - 클라이언트의 직접 INSERT 권한(orders/order_items/slots)을 제거하고,
--         오직 SECURITY DEFINER RPC 를 통해서만 주문이 생성되게 한다.
--   C2) 구독 해지 환불액을 서버에서 재계산한다(클라이언트 값 무시).
--   C3) 요일별 정원(100) 마감을 원자적으로 처리(동시 주문 초과 접수 방지).
-- ───────────────────────────────────────────────────────────

-- ── 가격 권위 테이블 ────────────────────────────────────────
create table if not exists public.product_catalog (
  id        text primary key,
  name      text not null,
  volume    text not null,
  price     integer not null check (price >= 0),
  tax_free  boolean not null default false,
  active    boolean not null default true
);

insert into public.product_catalog (id, name, volume, price, tax_free) values
  ('milk-180',   'A2 저지 헤이밀크',     '180mL', 3500,  true),
  ('milk-750',   'A2 저지 헤이밀크',     '750mL', 12000, true),
  ('yogurt-180', 'A2 저지 플레인 요거트', '180mL', 4300,  false),
  ('yogurt-500', 'A2 저지 플레인 요거트', '500mL', 10000, false)
on conflict (id) do update set
  name     = excluded.name,
  volume   = excluded.volume,
  price    = excluded.price,
  tax_free = excluded.tax_free,
  active   = true;

alter table public.product_catalog enable row level security;

-- 가격은 누구나 읽기(표시용). 변경은 관리자만.
drop policy if exists "catalog_select_all" on public.product_catalog;
create policy "catalog_select_all" on public.product_catalog
  for select using (true);

drop policy if exists "catalog_insert_admin" on public.product_catalog;
create policy "catalog_insert_admin" on public.product_catalog
  for insert with check (public.is_admin());

drop policy if exists "catalog_update_admin" on public.product_catalog;
create policy "catalog_update_admin" on public.product_catalog
  for update using (public.is_admin());

-- ── 보조 함수: 기간 할인율 / 주문번호 ──────────────────────
create or replace function public.period_discount(p_months int)
returns numeric
language sql
immutable
as $$
  select case p_months
    when 1  then 0.10
    when 3  then 0.15
    when 6  then 0.20
    when 12 then 0.25
    else null
  end;
$$;

create or replace function public.gen_order_no()
returns text
language sql
volatile
as $$
  select 'SY'
    || to_char((now() at time zone 'Asia/Seoul'), 'YYYYMMDD')
    || '-'
    || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
$$;

-- ── C1: 정기구독 주문 생성 RPC (서버측 금액 재계산 + C3 정원 잠금) ──
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

  if v_per_delivery < 20000 then
    raise exception '회당 최소 상품 금액은 20,000원입니다.';
  end if;
  v_shipping := (case when v_per_list >= 50000 then 0 else 4000 end) * v_weeks;
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

-- ── C1: 단품(1회) 주문 생성 RPC (서버측 금액 재계산 + KST 발송일) ──
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
  v_shipping := case when v_subtotal >= 50000 then 0 else 4000 end;
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

-- ── C1: 클라이언트 직접 INSERT 권한 제거 (이제 RPC만 주문 생성) ──
-- 기존 정책 제거 → 위·변조된 금액으로 직접 INSERT 하는 경로를 차단.
drop policy if exists "orders_insert_own" on public.orders;
drop policy if exists "order_items_insert_own" on public.order_items;
drop policy if exists "slots_insert_own" on public.subscription_slots;

-- ── C2: 구독 해지 환불액 서버 재계산 ───────────────────────
-- 기존 (…, integer) 시그니처 제거 후, 환불액을 인자로 받지 않는 버전으로 교체.
drop function if exists public.cancel_subscription(bigint, text, text, integer);

create or replace function public.cancel_subscription(
  p_slot_id        bigint,
  p_reason         text,
  p_refund_account text
)
returns integer   -- 서버가 계산한 환불액(원)을 반환
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_weeks int;
  v_total_amount int;
  v_started     date;
  v_paused      boolean;
  v_paused_at   date;
  v_paused_days int;
  v_today       date := (now() at time zone 'Asia/Seoul')::date;
  v_elapsed     int;
  v_delivered   int;
  v_remaining   int;
  v_refund      int;
begin
  select s.started_at, s.paused, s.paused_at, s.paused_days,
         coalesce(o.block_weeks, 0), coalesce(o.total_amount, 0)
    into v_started, v_paused, v_paused_at, v_paused_days, v_total_weeks, v_total_amount
    from public.subscription_slots s
    left join public.orders o on o.id = s.order_id
   where s.id = p_slot_id
     and s.user_id = auth.uid()
     and s.status in ('활성','대기')
   for update of s;
  if not found then
    raise exception '해지할 수 있는 구독이 아닙니다.';
  end if;

  -- 남은(미배송) 회차 산출 — lib/subscription-schedule.ts 와 동일한 규칙.
  if v_started is null then
    v_remaining := v_total_weeks;
  else
    v_elapsed := (v_today - v_started)
      - (v_paused_days
         + case when v_paused and v_paused_at is not null
                then greatest(0, v_today - v_paused_at) else 0 end);
    if v_elapsed < 0 then
      v_delivered := 0;
    else
      v_delivered := least(v_total_weeks, (v_elapsed / 7) + 1);
    end if;
    v_remaining := greatest(0, v_total_weeks - v_delivered);
  end if;

  if v_total_weeks > 0 then
    v_refund := (round(v_total_amount::numeric / v_total_weeks) * v_remaining)::int;
  else
    v_refund := 0;
  end if;

  update public.subscription_slots
     set status         = '해지',
         paused         = false,
         paused_at      = null,
         cancel_reason  = p_reason,
         refund_account = p_refund_account,
         refund_amount  = v_refund,
         cancelled_at   = v_today
   where id = p_slot_id;

  return v_refund;
end;
$$;

grant execute on function public.cancel_subscription(bigint, text, text) to authenticated;
