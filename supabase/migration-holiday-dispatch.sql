-- 공휴일 발송일 반영(단품). 주말만 스킵하던 발송일 계산에 한국 공휴일을 추가한다.
--
-- 문제: _create_once_order_core 의 ship_date 계산이 토·일만 건너뛰어, 공휴일이 발송일로
--       잡히면 신선식품(우유)이 택배 창고에 묶여 상한다.
--
-- 해결: kr_holidays 테이블 + next_dispatch_date() 헬퍼로 주말+공휴일을 모두 건너뛴다.
--       단품 주문 생성 함수(_create_once_order_core)가 이 헬퍼를 사용한다.
--       (클라이언트 표시는 lib/ship-date.ts + lib/holidays.ts 가 동일 규칙으로 처리.)
--
-- ⚠ 구독 첫 배송일/주차별 배송(고정 요일 cadence)의 공휴일 처리는 로스터 엔진 레벨 작업이라
--    이 마이그레이션 범위에서 제외한다(다음 영업일로 미루면 '매주 화요일' 주기가 깨짐 — 별도 설계 필요).
--
-- ⚠ kr_holidays 목록은 lib/holidays.ts 의 KR_HOLIDAYS 와 반드시 동일하게 유지한다(연 1회 동반 갱신).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행: migration-guest-checkout.sql(_create_once_order_core 정의), migration-min-order-25k.sql.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 공휴일 테이블 + seed. lib/holidays.ts 와 동일 목록(2026·2027).
--    RLS enable + 읽기 정책(공개) — 발송일 계산용 비민감 데이터.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.kr_holidays (
  d date primary key
);

alter table public.kr_holidays enable row level security;

drop policy if exists kr_holidays_read on public.kr_holidays;
create policy kr_holidays_read on public.kr_holidays for select using (true);

insert into public.kr_holidays (d) values
  -- 2026
  ('2026-01-01'),('2026-02-16'),('2026-02-17'),('2026-02-18'),
  ('2026-03-01'),('2026-03-02'),('2026-05-05'),('2026-05-24'),('2026-05-25'),
  ('2026-06-06'),('2026-08-15'),('2026-08-17'),
  ('2026-09-24'),('2026-09-25'),('2026-09-26'),('2026-09-28'),
  ('2026-10-03'),('2026-10-05'),('2026-10-09'),('2026-12-25'),
  -- 2027
  ('2027-01-01'),('2027-02-06'),('2027-02-07'),('2027-02-08'),('2027-02-09'),
  ('2027-03-01'),('2027-05-05'),('2027-05-13'),('2027-06-06'),
  ('2027-08-15'),('2027-08-16'),
  ('2027-09-14'),('2027-09-15'),('2027-09-16'),
  ('2027-10-03'),('2027-10-04'),('2027-10-09'),('2027-10-11'),
  ('2027-12-25'),('2027-12-27')
on conflict (d) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. 발송일 헬퍼. lib/ship-date.ts 의 nextDispatchDate 와 동일 규칙:
--    토→화·일→화·평일→익일(최소) 후, 주말·공휴일이면 다음 영업일까지 전진.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.next_dispatch_date(p_order_date date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v     date;
  v_dow int := extract(dow from p_order_date)::int;  -- 0=일 … 6=토
begin
  if v_dow = 6 then
    v := p_order_date + 3;   -- 토 → 화(최소)
  elsif v_dow = 0 then
    v := p_order_date + 2;   -- 일 → 화(최소)
  else
    v := p_order_date + 1;   -- 평일 → 익일(최소)
  end if;
  -- 주말·공휴일이면 다음 영업일로 미룬다.
  while extract(dow from v)::int in (0, 6)
        or exists (select 1 from public.kr_holidays h where h.d = v) loop
    v := v + 1;
  end loop;
  return v;
end;
$$;

grant execute on function public.next_dispatch_date(date) to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. 단품 주문 코어 재정의. 기존 본문을 그대로 보존하고, ship_date 계산만
--    next_dispatch_date() 호출로 교체한다(주말+공휴일 스킵).
--    (migration-guest-checkout.sql 의 _create_once_order_core 정의 기준.)
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
