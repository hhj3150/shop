-- 회차 보존 안전장치 — 일시정지·건너뛰기·요일 변경·배송일 변경이 서로 겹칠 때 회차가 사라지거나
-- 두 번 나가는 경우를 서버에서 막는다 (2026-10-13 구독 생애주기 점검 결과).
--
--   [점검으로 드러난 빈틈] 각 기능은 단독으로는 회차를 보존하지만, 겹치면 틀어진다.
--     1) 옮겨 둔 회차가 '나가기 전'에 정지(또는 건너뛰기)하면 그 회차가 사라진다.
--        예정일 10/19 → 10/21 로 옮긴 뒤 10/20 에 정지: 정지 구간 계산은 예정일(10/19)만 보므로
--        이미 지난 10/19 는 놓친 회차로 세지 않고, 10/21 은 정지 중이라 안 나간다 → 1회 소실.
--     2) 정지(건너뛰기) 중인 구독의 회차를 옮기면 새 날짜에도 안 나간다(정지 중) → 같은 소실.
--     3) 요일 변경을 '새 요일의 배송일 당일'에 하면 그날 명단에 바로 오른다. 앵커 검사는 그 자리를
--        '이미 나간 회차'로 세어 통과시키므로 같은 주에 두 번 나가고 달력은 한 회차를 더 센다.
--     4) 요일을 바꾸면 옮겨 둔 회차 기록(요일 키)이 고아가 된다 — 새 요일 명단에 안 뜨거나,
--        달력이 이미 나간 것으로 친 회차가 새 날짜에 또 나간다.
--     5) 한 주문이 두 요일을 구독할 때 다른 요일 자리로 옮기면 한 날 두 회차 → 출고 기록
--        (주문|발송일) 키가 하나라 한 회차로 세어진다.
--
--   [규칙]
--     · 정지·건너뛰기 전: 아직 오지 않은 예정일의 변경 기록은 지운다(정지가 우선한다). 예정일은
--       지났는데 새 날짜가 아직인 '진행 중' 변경이 있으면 정지를 거절한다 — 그 배송이 나간 뒤 정지.
--     · 배송일 변경: 정지 중 구독 거절, 같은 주문의 다른 요일 배송일 거절.
--     · 요일 변경: 진행 중(새 날짜가 오늘 이후) 변경 기록이 있으면 거절, 오늘이 새 요일의 배송일이면
--       거절(정지 중이면 허용 — 오늘 명단에 오르지 않는다).
--
--   본문은 운영 DB 현행 정의(2026-10-13 pg_get_functiondef 실측)에 검사만 더한 것이다.
--   적용: Supabase SQL Editor 에서 전체 실행(또는 MCP). 멱등.
--   선행: migration-shipment-reschedule.sql(shipment_reschedules), migration-holiday-dispatch.sql,
--         missed_delivery_weeks / sub_delivery_dates / ship_date_in_week / kst_today 현행.

do $$
begin
  if to_regclass('public.shipment_reschedules') is null then
    raise exception '선행 누락: public.shipment_reschedules — migration-shipment-reschedule.sql 을 먼저 적용하세요.';
  end if;
  if to_regprocedure('public.missed_delivery_weeks(date,date,integer,integer,date,date)') is null then
    raise exception '선행 누락: public.missed_delivery_weeks';
  end if;
  if to_regprocedure('public.ship_date_in_week(date)') is null then
    raise exception '선행 누락: public.ship_date_in_week(date)';
  end if;
  if to_regprocedure('public.kst_today()') is null then
    raise exception '선행 누락: public.kst_today()';
  end if;
end $$;

-- ── 0) 정지 전 변경 기록 정리 — 세 정지 경로(손님 정지·건너뛰기·관리자 정지)가 공용 ───────
--   본인 슬롯 또는 관리자만. 미래 예정일 변경은 지우고, 진행 중 변경이 있으면 예외.
create or replace function public.guard_pause_reschedules(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   record;
  v_today  date := public.kst_today();
  v_inflight record;
begin
  select * into v_slot from public.subscription_slots where id = p_slot_id;
  if not found then return; end if;
  if not public.is_admin() and v_slot.user_id is distinct from auth.uid() then
    raise exception '본인 구독만 정지할 수 있습니다.';
  end if;

  -- 진행 중 변경: 예정일은 지났고 새 날짜는 오늘 이후이며 아직 안 나간 회차.
  select x.* into v_inflight
    from public.shipment_reschedules x
    join public.orders o on o.id = x.order_id
   where (o.id = v_slot.order_id or o.renews_slot_id = v_slot.id)
     and x.delivery_day = v_slot.delivery_day
     and x.from_date < v_today
     and x.to_date >= v_today
     and not exists (select 1 from public.shipment_log l
                      where l.order_id = x.order_id and l.ship_date = x.to_date)
   limit 1;
  if found then
    raise exception '%에 보내기로 옮겨 둔 배송이 있습니다. 그 배송이 나간 뒤에 정지할 수 있습니다.',
      to_char(v_inflight.to_date, 'MM/DD');
  end if;

  -- 아직 오지 않은 예정일의 변경은 정지가 대신한다 → 지운다(놓친 회차 계산이 예정일 기준이라 안전).
  delete from public.shipment_reschedules x
   using public.orders o
   where o.id = x.order_id
     and (o.id = v_slot.order_id or o.renews_slot_id = v_slot.id)
     and x.delivery_day = v_slot.delivery_day
     and x.from_date >= v_today;
end;
$$;

revoke all on function public.guard_pause_reschedules(bigint) from public;
revoke execute on function public.guard_pause_reschedules(bigint) from anon;
grant execute on function public.guard_pause_reschedules(bigint) to authenticated;

-- ── 1) 손님 일시정지 ────────────────────────────────────────────────────────
create or replace function public.pause_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.guard_pause_reschedules(p_slot_id);
  update public.subscription_slots
     set paused = true,
         paused_at = (now() at time zone 'Asia/Seoul')::date
   where id = p_slot_id
     and user_id = auth.uid()
     and status = '활성'
     and paused = false;
  if not found then
    raise exception '일시정지할 수 있는 활성 구독이 아닙니다.';
  end if;
end;
$$;

-- ── 2) 손님 이번 주 건너뛰기 ────────────────────────────────────────────────
create or replace function public.skip_next_delivery(p_slot_id bigint, p_skip_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_skip_date is null or p_skip_date <= v_today then
    raise exception '건너뛸 다음 배송일이 올바르지 않습니다.';
  end if;

  perform public.guard_pause_reschedules(p_slot_id);

  update public.subscription_slots
     set paused = true,
         paused_at = v_today,
         skip_resume_on = p_skip_date + 1
   where id = p_slot_id
     and user_id = auth.uid()
     and status = '활성'
     and started_at is not null
     and paused = false
     and skip_resume_on is null;
  if not found then
    raise exception '이번 주 건너뛰기를 할 수 있는 활성 구독이 아닙니다.';
  end if;
end;
$$;

-- ── 3) 관리자 정지·재개 ─────────────────────────────────────────────────────
create or replace function public.admin_set_subscription_paused(p_slot_id bigint, p_paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   record;
  v_today  date := public.kst_today();
  v_total  int;
  v_missed int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_slot from public.subscription_slots where id = p_slot_id for update;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;
  if v_slot.status <> '활성' then
    raise exception '활성 구독만 정지·재개할 수 있습니다.';
  end if;

  if p_paused then
    if v_slot.paused then
      return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', false);
    end if;
    perform public.guard_pause_reschedules(p_slot_id);
    update public.subscription_slots
       set paused = true, paused_at = v_today, skip_resume_on = null
     where id = p_slot_id;
    return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', true);
  end if;

  if not v_slot.paused then
    return jsonb_build_object('slot_id', p_slot_id, 'paused', false, 'changed', false);
  end if;

  -- 총 회차 = 원주문 block_weeks + 슬롯 extended_weeks (resume_subscription 과 동일).
  select greatest(coalesce(o.block_weeks, 0) + coalesce(v_slot.extended_weeks, 0), 1)
    into v_total
    from public.orders o
   where o.id = v_slot.order_id;
  v_total := coalesce(v_total, 1);

  -- 재개일 당일은 정상 발송된다 → [정지일, 재개일).
  v_missed := public.missed_delivery_weeks(
    v_slot.started_at, v_slot.first_ship_date, v_total,
    v_slot.paused_days, v_slot.paused_at, v_today
  );

  update public.subscription_slots
     set paused         = false,
         paused_at      = null,
         paused_days    = coalesce(paused_days, 0) + v_missed * 7,
         skip_resume_on = null
   where id = p_slot_id;

  return jsonb_build_object(
    'slot_id', p_slot_id, 'paused', false, 'changed', true,
    'missed_rounds', v_missed, 'added_days', v_missed * 7
  );
end;
$$;

-- ── 4) 배송일 변경 — 정지 중 거절·다른 요일 자리 거절 ───────────────────────
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
  v_to_day text;
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

  -- 정지(건너뛰기) 중인 구독은 새 날짜에도 나가지 않는다 → 회차 소실. 먼저 재개해야 한다.
  if exists (select 1 from public.subscription_slots s
              where s.delivery_day = p_delivery_day
                and (s.order_id = p_order_id or s.id = v_order.renews_slot_id)
                and s.paused) then
    raise exception '정지(건너뛰기) 중인 구독은 배송일을 옮길 수 없습니다. 먼저 재개한 뒤 옮기세요.';
  end if;

  -- 같은 주문의 다른 요일 배송일로는 옮기지 않는다(한 날 두 회차 → 출고 기록이 한 회차로 세어진다).
  v_to_day := (array['mon','tue','wed','thu','fri'])[extract(isodow from p_to)::int];
  if exists (select 1 from public.order_items i
              where i.order_id = p_order_id
                and i.delivery_day is not null
                and i.delivery_day <> p_delivery_day
                and i.delivery_day = v_to_day) then
    raise exception '그날은 이 주문의 다른 요일 배송일입니다. 한 날에 두 회차를 보낼 수 없습니다.';
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

-- ── 5) 요일 변경 — 진행 중 배송일 변경 거절·오늘이 새 요일 배송일이면 거절 ───────
create or replace function public.change_delivery_day(p_slot_id bigint, p_new_day text, p_new_started_at date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_admin      boolean := public.is_admin();
  v_slot       record;
  v_total      int;
  v_today      date := (now() at time zone 'Asia/Seoul')::date;
  v_daynum     int;
  v_before     int;
  v_after      int;
  v_taken      int;
  v_next       date;
  v_end        date;
  v_pending    record;
  v_week_base  date;
begin
  v_daynum := array_position(array['mon','tue','wed','thu','fri'], p_new_day);
  if v_daynum is null then
    raise exception '배송 요일은 월~금 중에서 선택해 주세요.';
  end if;

  select s.*, o.block_weeks into v_slot
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id
   where s.id = p_slot_id
   for update of s;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;

  if not v_admin and v_slot.user_id is distinct from v_uid then
    raise exception '본인 구독만 변경할 수 있습니다.';
  end if;
  if v_slot.status <> '활성' then
    raise exception '활성 구독만 요일을 바꿀 수 있습니다.';
  end if;
  if p_new_day = v_slot.delivery_day then
    raise exception '이미 그 요일로 받고 계십니다.';
  end if;

  -- 진행 중인 배송일 변경(새 날짜가 오늘 이후, 아직 안 나감)이 있으면 요일을 바꾸지 않는다.
  --   변경 기록은 (주문·요일·예정일) 키라 요일을 바꾸면 고아가 된다 — 새 요일 명단에 안 뜨거나,
  --   달력이 이미 나간 것으로 친 회차가 새 날짜에 또 나간다.
  select x.* into v_pending
    from public.shipment_reschedules x
    join public.orders o on o.id = x.order_id
   where (o.id = v_slot.order_id or o.renews_slot_id = v_slot.id)
     and x.delivery_day = v_slot.delivery_day
     and x.to_date >= v_today
     and not exists (select 1 from public.shipment_log l
                      where l.order_id = x.order_id and l.ship_date = x.to_date)
   limit 1;
  if found then
    raise exception '%로 옮겨 둔 배송이 있어 요일을 바꿀 수 없습니다. 먼저 되돌리거나 그 배송이 나간 뒤에 바꿔 주세요.',
      to_char(v_pending.to_date, 'MM/DD');
  end if;

  -- 오늘이 새 요일의 배송일이면(정지 중이 아닐 때) 바꾸지 않는다 — 바꾸는 즉시 오늘 명단에 올라
  --   같은 주에 두 번 나가고, 아래 앵커 검사는 그 자리를 이미 나간 회차로 세어 통과시킨다.
  if v_slot.started_at is not null and not v_slot.paused then
    v_week_base := v_today - (extract(isodow from v_today)::int - 1) + (v_daynum - 1);
    if public.ship_date_in_week(v_week_base) = v_today then
      raise exception '오늘이 새 요일의 배송일이라 지금은 바꿀 수 없습니다. 내일 이후에 다시 시도해 주세요.';
    end if;
  end if;

  v_total := greatest(v_slot.block_weeks + coalesce(v_slot.extended_weeks, 0), 1);

  perform pg_advisory_xact_lock(hashtext('slot_day:' || p_new_day));

  if exists (select 1 from public.subscription_slots s2
              where s2.user_id = v_slot.user_id
                and s2.delivery_day = p_new_day
                and s2.status <> '해지'
                and s2.id <> p_slot_id) then
    raise exception '이미 그 요일에 다른 구독이 있어 옮길 수 없습니다.';
  end if;

  select count(*) filter (where status in ('신청','활성')) into v_taken
    from public.subscription_slots where delivery_day = p_new_day;
  if v_taken >= 100 then
    raise exception '선택한 요일이 마감되어 옮길 수 없습니다.';
  end if;

  if v_slot.started_at is null then
    p_new_started_at := null;
  else
    if p_new_started_at is null then
      raise exception '새 시작 기준일이 필요합니다.';
    end if;
    if extract(isodow from p_new_started_at)::int <> v_daynum then
      raise exception '새 시작 기준일이 선택한 요일이 아닙니다.';
    end if;

    select count(*) into v_before
      from public.sub_delivery_dates(
             v_slot.started_at, v_slot.first_ship_date, v_total, v_slot.paused_days) d
     where d.ship_date <= v_today;

    select count(*) into v_after
      from public.sub_delivery_dates(p_new_started_at, null, v_total, v_slot.paused_days) d
     where d.ship_date <= v_today;

    if v_before <> v_after then
      raise exception '회차가 어긋나 요일을 바꿀 수 없습니다(기발송 %회 → %회). 이번 주 배송 뒤에 다시 시도해 주세요.',
        v_before, v_after;
    end if;
  end if;

  update public.subscription_slots
     set delivery_day    = p_new_day,
         started_at      = coalesce(p_new_started_at, started_at),
         first_ship_date = null
   where id = p_slot_id;

  update public.order_items i
     set delivery_day = p_new_day
    from public.orders o
   where o.id = i.order_id
     and (o.id = v_slot.order_id or o.renews_slot_id = p_slot_id)
     and i.delivery_day is not null;

  if p_new_started_at is not null then
    select min(d.ship_date) into v_next
      from public.sub_delivery_dates(p_new_started_at, null, v_total, v_slot.paused_days) d
     where d.ship_date > v_today;
    select max(d.ship_date) into v_end
      from public.sub_delivery_dates(p_new_started_at, null, v_total, v_slot.paused_days) d;
  end if;

  return jsonb_build_object(
    'slot_id', p_slot_id,
    'delivery_day', p_new_day,
    'started_at', p_new_started_at,
    'next_date', v_next,
    'end_date', v_end,
    'total_rounds', v_total
  );
end;
$$;

-- ── 검증 ─────────────────────────────────────────────────────────────────
-- select to_regprocedure('public.guard_pause_reschedules(bigint)');
-- select position('guard_pause_reschedules' in pg_get_functiondef('public.pause_subscription(bigint)'::regprocedure)) > 0;
-- select position('guard_pause_reschedules' in pg_get_functiondef('public.skip_next_delivery(bigint,date)'::regprocedure)) > 0;
-- select position('guard_pause_reschedules' in pg_get_functiondef('public.admin_set_subscription_paused(bigint,boolean)'::regprocedure)) > 0;
-- select position('다른 요일 배송일' in pg_get_functiondef('public.admin_reschedule_shipment(uuid,text,date,date,text)'::regprocedure)) > 0;
-- select position('오늘이 새 요일' in pg_get_functiondef('public.change_delivery_day(bigint,text,date)'::regprocedure)) > 0;
