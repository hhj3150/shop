-- 발송 전날 예고 SMS — 중복방지 원장 + 시크릿게이트 RPC(스케줄러용).
--
--   netlify/functions/ship-reminder 가 매일 저녁 다음날 배송 대상을 산출해 예고 문자를 보낸다.
--   배송 대상 산출은 서버(TS)에서 배송 명단 SSOT(buildRosterForDate)로 하므로, 여기서는
--     · 산출에 필요한 원자료(orders/items/slots)와 그날 이미 예고한 주문을 한 번에 내려주고,
--     · 발송 후 (주문, 발송일) 중복방지 원장을 기록한다.
--
--   시크릿: 기존 운영 cron 시크릿(payment_recovery_secret)을 재사용 → 추가 설정 불필요
--           (Netlify 환경변수 PAYMENT_RECOVERY_SECRET 그대로 사용).
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration).

-- 1) 중복 예고 방지 원장. 같은 (주문, 발송일)엔 1회만.
create table if not exists public.ship_reminder_log (
  order_id  uuid not null references public.orders(id) on delete cascade,
  ship_date date not null,
  sent_at   timestamptz not null default now(),
  primary key (order_id, ship_date)
);
alter table public.ship_reminder_log enable row level security;
-- 클라이언트 직접 접근 없음 — RPC(SECURITY DEFINER)로만 읽고 쓴다(정책 미부여 = 전면 차단).

-- 2) 예고 산출용 데이터셋. 확정류 주문 + 그 품목 + 전체 슬롯 + 그 발송일 기예고 주문.
--    시크릿게이트. 반환은 jsonb(서버 TS 가 buildRosterForDate 로 그날 배송분만 추린다).
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
        'is_gift', o.is_gift, 'gifter_name', o.gifter_name))
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
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.ship_reminder_dataset(text, date) to authenticated;

-- 3) 예고 기록(중복방지). 시크릿게이트. 같은 (주문, 발송일) 재기록은 무시.
create or replace function public.record_ship_reminder(p_secret text, p_order_id uuid, p_ship_date date)
returns void
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
  if p_order_id is null or p_ship_date is null then
    raise exception '주문·발송일이 필요합니다.';
  end if;

  insert into public.ship_reminder_log (order_id, ship_date)
    values (p_order_id, p_ship_date)
    on conflict (order_id, ship_date) do nothing;
end;
$$;

grant execute on function public.record_ship_reminder(text, uuid, date) to authenticated;
