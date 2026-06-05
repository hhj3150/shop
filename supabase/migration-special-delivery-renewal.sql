-- ─────────────────────────────────────────────────────────────
-- 특수배송지역(제주·도서산간 등) 배송비 5,000원 — 정기구독 '갱신(연장)' 경로
--
--   migration-special-delivery-region.sql 의 후속.
--   신규 주문(create_subscription_order / 단품)은 이미 특수지역 5,000원을 청구한다.
--   본 마이그레이션은 '연장(request_renewal)' 주문도 동일하게 맞춘다.
--
--   ⚠ 선행 의존: public.is_special_delivery_postcode(text) 가 먼저 생성돼 있어야 한다
--     (migration-special-delivery-region.sql 에서 생성). 미적용 시 먼저 그 파일을 적용할 것.
--
--   판별 기준은 lib/regions.ts 와 동기화(제주 63000-63644, 울릉 40200-40240 등).
--   연장은 원 주문의 배송지를 그대로 승계하므로 v_src.ship_postcode 로 판별한다.
--
--   본문 출처(라이브 최신): schema.sql 의 request_renewal.
--   외과적 수정: 배송비 줄(v_shipping)만 지역 분기로 교체, 나머지 100% 보존.
--
-- 멱등: create or replace. 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

create or replace function public.request_renewal(p_slot_id bigint)
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
  v_weeks        int := 4;       -- 1개월 = 4회
  v_item         record;
  v_price        int;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
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

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  v_rate := public.period_discount(1);

  for v_item in
    select oi.product_id, oi.qty from public.order_items oi where oi.order_id = v_src.id
  loop
    select price into v_price from public.product_catalog where id = v_item.product_id and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_item.qty;
    v_per_list     := v_per_list + v_price * v_item.qty;
  end loop;

  if v_per_delivery <= 0 then raise exception '연장할 품목이 없습니다.'; end if;
  -- 배송비는 항상 자부담. 제주·도서산간 등 특수배송지역은 회당 5,000원.
  --   연장은 원 주문 배송지를 승계하므로 원 주문의 우편번호로 판별한다.
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
    v_weeks, 1, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$$;

grant execute on function public.request_renewal(bigint) to authenticated;

-- ───────── 사장님 적용 절차 ─────────
-- 1) (선행 확인) is_special_delivery_postcode 가 있어야 한다:
--      select public.is_special_delivery_postcode('63322');  -- true 나오면 OK
--    없으면 migration-special-delivery-region.sql 을 먼저 적용.
-- 2) 위 함수를 Supabase SQL Editor 에서 실행.
-- 3) 검증: 제주 배송지의 활성 구독을 연장하면 shipping_fee = 5,000×4 = 20,000,
--    일반 지역은 4,000×4 = 16,000 으로 생성되는지 확인.
