-- '내일 발송' 예고 문자도 확정 회차로 센다 (2026-11-24)
--
-- ★ 무슨 일이 있었나
--   관리자 배송판은 회차를 '관리자가 확정한 회차 + 그 뒤 출고 기록'으로 센다. 그런데 전날 저녁
--   예고 문자(netlify/functions/ship-reminder)는 달력으로만 셌다 — 이 함수가 확정 정보를
--   돌려주지 않았기 때문이다. 둘이 갈리면 손님이 받는 문자와 실제 상자가 어긋난다.
--     · 12회를 다 받은 구독(슬롯 67)에 "내일 발송 예정" 문자가 나갈 뻔했다
--       (시작일이 옮겨져 달력은 6회가 남았다고 봤다. 11/24 데이터로 먼저 막았다).
--     · 연장 입금이 늦어 달력이 먼저 끝난 구독(슬롯 7·39·101)은 상자는 가는데 문자가 없다.
--
-- ★ 바꾼 것 — 운영 정의(2026-11-24 pg_get_functiondef)에 '더하기'만 했다
--   1) slots 에 delivery_day · rounds_confirmed_count · rounds_confirmed_at
--      (관리자 화면이 쓰는 것과 같은 입력. delivery_day 는 한 주문이 요일별 슬롯을 둘 가질 때
--       그 요일의 슬롯을 고르는 키다.)
--   2) shipments — 확정된 구독의 '확정일 뒤 · 예고 대상일 전' 출고 기록(주문 id · 발송일).
--      확정 회차에 더해 지금까지 나간 회차를 센다(lib/round-baseline shippedRoundsBeforeBySlot —
--      관리자 배송판과 같은 함수).
--   기존 키(orders · items · slots 의 옛 필드 · reminded · dispatched · reschedules)는 그대로다.
--   옛 함수 코드는 새 키를 읽지 않으므로, DB 를 먼저 올려도 예고 동작은 바뀌지 않는다.
--
-- 권한: 시그니처가 같아 기존 grant(anon·authenticated, 시크릿으로 보호)가 유지된다.

create or replace function public.ship_reminder_dataset(p_secret text, p_ship_date date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;
  if p_ship_date is null then raise exception '발송일이 필요합니다.'; end if;

  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status,
        'order_type', o.order_type, 'block_weeks', o.block_weeks,
        'shipping_fee', o.shipping_fee, 'created_at', o.created_at,
        'ship_date', o.ship_date, 'ship_name', o.ship_name, 'ship_phone', o.ship_phone,
        'delivery_method', o.delivery_method, 'renews_slot_id', o.renews_slot_id,
        'is_gift', o.is_gift, 'gifter_name', o.gifter_name,
        -- 단품 '이미 발송됨' 판정용(회차 이력이 없는 레거시 건까지 덮는다).
        'shipped_at', o.shipped_at, 'tracking_no', o.tracking_no))
      from public.orders o
      where o.status in ('입금확인','배송준비','배송중','배송완료')
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_id', i.order_id, 'product_name', i.product_name, 'volume', i.volume,
        'delivery_day', i.delivery_day, 'qty', i.qty, 'unit_price', i.unit_price))
      from public.order_items i
      join public.orders o on o.id = i.order_id
      where o.status in ('입금확인','배송준비','배송중','배송완료')
    ), '[]'::jsonb),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'order_id', s.order_id, 'status', s.status,
        'started_at', s.started_at, 'first_ship_date', s.first_ship_date,
        'paused', s.paused, 'paused_at', s.paused_at, 'paused_days', s.paused_days,
        'extended_weeks', s.extended_weeks,
        -- 관리자 배송판과 같은 입력: 요일별 슬롯 선택 키 + 확정 회차 기준점.
        'delivery_day', s.delivery_day,
        'rounds_confirmed_count', s.rounds_confirmed_count,
        'rounds_confirmed_at', s.rounds_confirmed_at))
      from public.subscription_slots s
    ), '[]'::jsonb),
    'reminded', coalesce((
      select jsonb_agg(r.order_id)
      from public.ship_reminder_log r
      where r.ship_date = p_ship_date
    ), '[]'::jsonb),
    -- 그 발송일분을 이미 출고(송장 기록)한 주문 — 예고 대상에서 제외한다.
    'dispatched', coalesce((
      select jsonb_agg(sl.order_id)
      from public.shipment_log sl
      where sl.ship_date = p_ship_date
        and (sl.tracking_no is not null or sl.shipped_at is not null)
    ), '[]'::jsonb),
    -- 회차 날짜 변경 — 예정일에서 빠지고 새 날짜에 들어간다(로스터가 적용).
    --   이동 폭이 ±6일이라 발송일 ±7일 창만 넘기면 충분하다.
    'reschedules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_id', x.order_id, 'delivery_day', x.delivery_day,
        'from_date', x.from_date, 'to_date', x.to_date))
      from public.shipment_reschedules x
      where x.from_date between p_ship_date - 7 and p_ship_date + 7
         or x.to_date   between p_ship_date - 7 and p_ship_date + 7
    ), '[]'::jsonb),
    -- 확정된 구독의 '확정일 뒤 · 예고 대상일 전' 출고 기록. 원주문과 연장주문 모두 그 슬롯에 묶는다.
    --   확정 전 구독의 기록은 싣지 않는다(달력으로 판정하므로 쓰이지 않는다).
    'shipments', coalesce((
      select jsonb_agg(distinct jsonb_build_object('order_id', sl.order_id, 'ship_date', sl.ship_date))
      from public.shipment_log sl
      join public.orders o on o.id = sl.order_id
      join public.subscription_slots s on s.order_id = o.id or s.id = o.renews_slot_id
      where s.rounds_confirmed_count is not null
        and s.rounds_confirmed_at is not null
        and sl.ship_date > s.rounds_confirmed_at
        and sl.ship_date < p_ship_date
    ), '[]'::jsonb)
  );
end;
$$;
