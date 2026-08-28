-- 발송 전날 예고 ② — 이미 출고된 건은 예고하지 않는다.
--
--   문제(실사고):
--     관리자는 발송일보다 며칠 앞서 송장을 등록하기도 한다(예: 8/31 발송분을 8/28 처리).
--     그러면 손님은 '상품이 발송되었습니다 + 송장번호' 문자를 이미 받았는데, 전날 저녁
--     예고 크론이 "내일 8월 31일 발송 예정입니다"를 한 통 더 보낸다.
--       · SY20260809-5830(단품): 8/14 발송 문자 → 8/17 예고 문자
--       · SY20260828-1695(단품): 8/28 발송 문자 → (미조치 시) 8/30 예고 문자
--
--   해법:
--     ship_reminder_dataset 이 그 발송일분의 '이미 출고된 주문'(shipment_log 에 송장이
--     기록된 (order_id, ship_date))을 함께 내려주고, 서버(TS)가 예고 대상에서 뺀다.
--     단품 판정 보강용으로 orders.shipped_at / tracking_no 도 함께 내린다.
--
--   호환: 반환 jsonb 에 키를 '추가'만 한다(기존 키·의미 그대로). 멱등(create or replace).
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration).

create or replace function public.ship_reminder_dataset(p_secret text, p_ship_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
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
        'extended_weeks', s.extended_weeks))
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
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.ship_reminder_dataset(text, date) to authenticated;

-- 검증
--   select jsonb_array_length(d->'dispatched')
--     from public.ship_reminder_dataset('<secret>', '2026-08-31') d;  -- 8/31 발송분 중 기출고 건수
