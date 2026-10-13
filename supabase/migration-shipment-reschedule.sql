-- 배송일 변경(회차 1회 이동) — 정기구독 한 회차를 다른 날로 옮긴다
--
--   [문제] 배송일은 요일 cadence 로만 계산한다(order_items.delivery_day + 공휴일·휴무 규칙).
--     "이번 주만 수요일에 보내 달라", "월요일 출고를 못 하게 됐다" 같은 변수가 생겨도
--     관리자가 할 수 있는 건 요일 영구 변경(change_delivery_day)·일시정지·건너뛰기뿐이었다.
--     한 회차만 날짜를 옮기는 장치가 없어 현장은 수기로 보내고 기록은 어긋났다.
--
--   [설계] 회차의 '예정일 → 실제 발송일' 이동 기록을 따로 둔다. 요일·앵커·정지일수·회차 수는
--     건드리지 않는다 — 그걸 흔들면 전 회차 일정과 환불 계산이 통째로 움직인다.
--       · 배송 명단·배송 시트·발송 예고(TS buildRosterForDate)가 이 표를 읽어
--         예정일에서는 빼고 새 날짜에 넣는다. 회차 번호는 예정일 기준 그대로다.
--       · 이동 폭은 ±6일 이내로 제한한다. 7일 이상 움직이면 앞뒤 회차와 같은 주에 겹쳐
--         회차 번호·발송 수 계산이 어긋난다. 그 이상은 일시정지/건너뛰기를 쓴다.
--       · 새 날짜는 평일이면서 발송 불가일(공휴일·목장 휴무)이 아니어야 한다.
--       · 이미 출고된 회차(shipment_log)는 옮길 수 없다. 옮긴 뒤 새 날짜로 출고되면 되돌릴 수 없다.
--     단품 주문은 orders.ship_date 를 바꾸면 되므로 이 표를 쓰지 않는다.
--
--   [내용]
--     1) shipment_reschedules 표 + RLS(관리자 전체, 손님은 본인 주문분 조회)
--     2) admin_reschedule_shipment() — 등록/수정(관리자)
--     3) admin_cancel_reschedule()   — 취소(관리자)
--     4) ship_reminder_dataset()     — 'reschedules' 키 추가(발송 전날 예고가 새 날짜를 따르게)
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-holiday-dispatch.sql(is_dispatch_blocked), migration-order-events.sql(order_events),
--         migration-ship-reminder-dispatched.sql(ship_reminder_dataset 현행 본문).

do $$
begin
  if to_regprocedure('public.is_dispatch_blocked(date)') is null then
    raise exception '선행 누락: public.is_dispatch_blocked(date) — migration-holiday-dispatch.sql 을 먼저 적용하세요.';
  end if;
  if to_regclass('public.order_events') is null then
    raise exception '선행 누락: public.order_events — migration-order-events.sql 을 먼저 적용하세요.';
  end if;
  if to_regclass('public.shipment_log') is null then
    raise exception '선행 누락: public.shipment_log';
  end if;
end $$;

-- ── 1) 표 ────────────────────────────────────────────────────────────────
create table if not exists public.shipment_reschedules (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders(id) on delete cascade,
  delivery_day text not null check (delivery_day in ('mon','tue','wed','thu','fri')),
  from_date    date not null,   -- 원래 예정일(요일 규칙이 내는 발송일)
  to_date      date not null,   -- 실제로 보낼 날
  note         text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint shipment_reschedules_moves check (to_date <> from_date),
  constraint shipment_reschedules_window check (abs(to_date - from_date) < 7),
  constraint shipment_reschedules_one_per_round unique (order_id, delivery_day, from_date)
);

create index if not exists shipment_reschedules_to_idx on public.shipment_reschedules (to_date);

alter table public.shipment_reschedules enable row level security;

drop policy if exists "shipment_reschedules_select" on public.shipment_reschedules;
create policy "shipment_reschedules_select" on public.shipment_reschedules
  for select using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = shipment_reschedules.order_id and o.user_id = auth.uid())
  );
-- 쓰기는 RPC(security definer)로만 한다 — insert/update/delete 정책 없음.
--   Supabase 기본 권한(default privileges)이 anon/authenticated 에 all 을 주므로 명시적으로 거둔다.
--   (RLS 만으로도 막히지만, 정책 실수 한 번에 열리지 않게 권한 단계에서도 닫는다.)

grant select on public.shipment_reschedules to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.shipment_reschedules from anon, authenticated;
revoke select on public.shipment_reschedules from anon;

-- ── 2) 등록/수정 ─────────────────────────────────────────────────────────
create or replace function public.admin_reschedule_shipment(
  p_order_id     uuid,
  p_delivery_day text,
  p_from         date,
  p_to           date,
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_id    bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_order_id is null or p_from is null or p_to is null then
    raise exception '주문·예정일·새 날짜가 모두 필요합니다.';
  end if;
  if p_delivery_day is null or p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  if v_order.order_type <> '구독' then
    raise exception '정기구독 회차만 날짜를 옮길 수 있습니다. 단품은 발송예정일을 직접 바꾸세요.';
  end if;

  if p_to = p_from then raise exception '같은 날짜입니다.'; end if;
  if abs(p_to - p_from) >= 7 then
    raise exception '6일 이내로만 옮길 수 있습니다(앞뒤 회차와 겹칩니다). 더 미루려면 일시정지·건너뛰기를 쓰세요.';
  end if;
  if extract(isodow from p_to)::int > 5 then
    raise exception '주말에는 발송할 수 없습니다.';
  end if;
  if public.is_dispatch_blocked(p_to) then
    raise exception '그날은 공휴일·휴무일이라 발송할 수 없습니다.';
  end if;

  -- 이미 나간 회차는 옮길 수 없다(기록이 사실이다).
  if exists (select 1 from public.shipment_log l where l.order_id = p_order_id and l.ship_date = p_from) then
    raise exception '이미 출고된 회차는 날짜를 바꿀 수 없습니다.';
  end if;
  -- 새 날짜에 이 주문의 다른 출고가 이미 있으면 한 날에 두 회차가 된다 → 막는다.
  if exists (select 1 from public.shipment_log l where l.order_id = p_order_id and l.ship_date = p_to) then
    raise exception '그날은 이 주문의 다른 회차가 이미 출고된 날입니다.';
  end if;

  insert into public.shipment_reschedules (order_id, delivery_day, from_date, to_date, note, created_by)
  values (p_order_id, p_delivery_day, p_from, p_to, nullif(trim(p_note), ''), auth.uid())
  on conflict (order_id, delivery_day, from_date) do update
    set to_date = excluded.to_date,
        note = excluded.note,
        created_by = excluded.created_by,
        created_at = now()
  returning id into v_id;

  insert into public.order_events (order_id, event, actor_id, reason, meta)
  values (p_order_id, 'reschedule', auth.uid(), nullif(trim(p_note), ''),
          jsonb_build_object('delivery_day', p_delivery_day, 'from_date', p_from, 'to_date', p_to));

  return jsonb_build_object('id', v_id, 'order_id', p_order_id, 'delivery_day', p_delivery_day,
                            'from_date', p_from, 'to_date', p_to);
end;
$$;

revoke all on function public.admin_reschedule_shipment(uuid, text, date, date, text) from public;
revoke execute on function public.admin_reschedule_shipment(uuid, text, date, date, text) from anon;
grant execute on function public.admin_reschedule_shipment(uuid, text, date, date, text) to authenticated;

-- ── 3) 취소 ──────────────────────────────────────────────────────────────
create or replace function public.admin_cancel_reschedule(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  select * into v_row from public.shipment_reschedules where id = p_id for update;
  if not found then raise exception '변경 기록을 찾을 수 없습니다.'; end if;

  -- 옮긴 날짜로 이미 출고됐으면 되돌릴 수 없다(기록이 사실이다).
  if exists (select 1 from public.shipment_log l where l.order_id = v_row.order_id and l.ship_date = v_row.to_date) then
    raise exception '옮긴 날짜로 이미 출고된 회차라 되돌릴 수 없습니다.';
  end if;

  delete from public.shipment_reschedules where id = p_id;

  insert into public.order_events (order_id, event, actor_id, meta)
  values (v_row.order_id, 'reschedule_cancel', auth.uid(),
          jsonb_build_object('delivery_day', v_row.delivery_day, 'from_date', v_row.from_date, 'to_date', v_row.to_date));

  return jsonb_build_object('id', p_id, 'order_id', v_row.order_id, 'from_date', v_row.from_date, 'to_date', v_row.to_date);
end;
$$;

revoke all on function public.admin_cancel_reschedule(bigint) from public;
revoke execute on function public.admin_cancel_reschedule(bigint) from anon;
grant execute on function public.admin_cancel_reschedule(bigint) to authenticated;

-- ── 4) 발송 전날 예고 데이터셋 — 'reschedules' 키 추가 ───────────────────
--   본문은 운영 DB 현행 정의(2026-10-13 pg_get_functiondef 실측)에 키 하나만 더한 것이다.
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
    ), '[]'::jsonb)
  );
end;
$$;

-- ── 검증 ─────────────────────────────────────────────────────────────────
-- select to_regclass('public.shipment_reschedules');                                  -- 표
-- select p.oid::regprocedure from pg_proc p where p.proname like 'admin_%reschedule%'; -- RPC 2개
-- select jsonb_typeof(public.ship_reminder_dataset(
--   (select decrypted_secret from vault.decrypted_secrets where name='payment_recovery_secret'),
--   public.kst_today()) -> 'reschedules');                                            -- 'array'
