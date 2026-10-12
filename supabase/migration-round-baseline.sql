-- 구독 회차 '확정 기준점' — 관리자가 한 번 선언하면 그 뒤로는 기록이 진실이 된다.
--
--   [배경] 2026-06~10 로젠 송장 994건을 운송장번호로 대조한 결과, 실제로 나갔는데
--     shipment_log 에 없는 구독 회차가 상당수 있었다. 출고 버튼이 송장번호를 필수로
--     요구해, 그 입력이 빠진 회차는 stock_ship_out 까지 건너뛰어 기록이 통째로
--     남지 않았기 때문이다(앱 쪽은 이미 고쳤다 — 송장 없이도 출고가 기록된다).
--
--   [왜 과거를 자동 복구하지 않는가] 로젠 파일에는 '이 상자가 구독분이었나 홍보분이었나'가
--     없다. 물품명은 전부 '농산물', 수량·운임도 동일하다. 목장은 구독·단품과 별개로
--     홍보 발송을 많이 하는데(대조 결과 343건, 전체의 35%), 그걸 구독 회차로 잘못 세면
--     손님이 결제한 회차가 깎인다. 되돌릴 수 없는 방향이라 추론하지 않는다.
--
--   [대신] 관리자가 고객별로 '지금까지 몇 회 나갔는지'를 확정하고, 그 시점부터
--     shipment_log 로 정확히 센다.  발송 회차 = 확정값 + (확정일 이후 기록)
--
--   [기존 질서를 건드리지 않는다]
--     · shipment_log 에 가짜 행을 만들지 않는다 → 손님 마이페이지 배송 이력이 안 더럽혀진다.
--     · started_at · first_ship_date · paused_days 를 손대지 않는다 → 배송 요일·휴무
--       이월·정지 보정이 그대로다. 이걸 흔들면 전 회차 일정이 통째로 밀린다.
--     · block_weeks · extended_weeks 를 손대지 않는다 → 총 회차·환불 금액 체계 불변.
--     · 확정 전 슬롯은 컬럼이 null 이라 기존 계산이 그대로 돈다 → 한 명씩 점진 적용.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행. 멱등.

-- ── 1) 컬럼 ──────────────────────────────────────────────────────────────
alter table public.subscription_slots
  add column if not exists rounds_confirmed_count int,
  add column if not exists rounds_confirmed_at    date,
  add column if not exists rounds_confirmed_by    uuid,
  add column if not exists rounds_confirmed_note  text;

comment on column public.subscription_slots.rounds_confirmed_count is
  '관리자가 확정한 "확정일까지 나간 회차 수". null이면 미확정(옛 계산 유지).';
comment on column public.subscription_slots.rounds_confirmed_at is
  '확정 기준일(KST). 이 날짜까지는 rounds_confirmed_count 가 진실, 이후는 shipment_log 로 센다.';

-- 둘은 항상 같이 있거나 같이 없어야 한다 — 한쪽만 있으면 계산이 어디서 끊길지 모른다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_slots_rounds_confirmed_pair'
  ) then
    alter table public.subscription_slots
      add constraint subscription_slots_rounds_confirmed_pair
      check (
        (rounds_confirmed_count is null and rounds_confirmed_at is null)
        or (rounds_confirmed_count is not null and rounds_confirmed_at is not null
            and rounds_confirmed_count >= 0)
      );
  end if;
end $$;


-- ── 2) 확정 회차 조회 헬퍼 ───────────────────────────────────────────────
--   발송 회차 = 확정값 + (확정일 이후 서로 다른 발송일 수).
--   미확정이면 null 을 돌려준다 — 호출처가 옛 방식(달력)으로 떨어진다.
--
--   ★ 한 날짜 = 한 회차다. 날짜를 distinct 로 센다. 원주문과 연장주문이 한 슬롯에
--     묶이므로 실수로 같은 날 둘 다 출고하면 행이 둘 생기는데, 그대로 세면 손님이
--     결제한 회차가 하나 사라진다.
create or replace function public.slot_shipped_rounds(p_slot_id bigint)
returns int
language sql
stable
set search_path = public
as $$
  select case
           when s.rounds_confirmed_count is null or s.rounds_confirmed_at is null then null
           else s.rounds_confirmed_count + (
             select count(distinct sl.ship_date)::int
               from public.shipment_log sl
              where sl.ship_date > s.rounds_confirmed_at
                and (sl.order_id = s.order_id
                     or sl.order_id in (select r.id from public.orders r
                                         where r.renews_slot_id = s.id))
           )
         end
    from public.subscription_slots s
   where s.id = p_slot_id;
$$;

grant execute on function public.slot_shipped_rounds(bigint) to authenticated;


-- ── 3) 관리자 확정 RPC ───────────────────────────────────────────────────
--   사장님이 화면에서 숫자를 확인하고 누르면 이게 돈다. 이력을 order_events 에 남긴다
--   (나중에 "왜 이 숫자가 됐나"를 되짚을 수 있어야 한다).
create or replace function public.admin_confirm_slot_rounds(
  p_slot_id bigint,
  p_count   int,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot  record;
  v_today date := public.kst_today();
  v_total int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_count is null or p_count < 0 then
    raise exception '확정 회차는 0 이상이어야 합니다.';
  end if;

  select * into v_slot from public.subscription_slots where id = p_slot_id for update;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;

  -- 결제한 회차를 넘겨 확정할 수 없다 — 넘기면 손님이 받을 회차가 사라진다.
  select greatest(coalesce(o.block_weeks,0) + coalesce(v_slot.extended_weeks,0), 1)
    into v_total from public.orders o where o.id = v_slot.order_id;
  if p_count > coalesce(v_total, 0) then
    raise exception '결제 회차(%)보다 많이 확정할 수 없습니다: %', v_total, p_count;
  end if;

  update public.subscription_slots
     set rounds_confirmed_count = p_count,
         rounds_confirmed_at    = v_today,
         rounds_confirmed_by    = auth.uid(),
         rounds_confirmed_note  = nullif(trim(coalesce(p_note,'')), '')
   where id = p_slot_id;

  insert into public.order_events (order_id, kind, note, created_by)
    values (v_slot.order_id, '회차확정',
            format('슬롯 %s · %s회로 확정(기준일 %s)%s',
                   p_slot_id, p_count, v_today,
                   case when coalesce(trim(p_note),'') = '' then ''
                        else ' · ' || trim(p_note) end),
            auth.uid());

  return jsonb_build_object(
    'slot_id', p_slot_id, 'confirmed_count', p_count,
    'confirmed_at', v_today, 'total', v_total
  );
end;
$$;

revoke all on function public.admin_confirm_slot_rounds(bigint, int, text) from public;
revoke execute on function public.admin_confirm_slot_rounds(bigint, int, text) from anon;
grant execute on function public.admin_confirm_slot_rounds(bigint, int, text) to authenticated;


-- 검증 (읽기만)
--   -- 확정된 슬롯과 현재 발송 회차
--   select s.id, p.name, s.rounds_confirmed_count, s.rounds_confirmed_at,
--          public.slot_shipped_rounds(s.id) as 현재_발송회차
--     from public.subscription_slots s join public.profiles p on p.id = s.user_id
--    where s.rounds_confirmed_at is not null order by s.id;
--   -- 미확정 슬롯 수(0이 되면 전수 확정 완료)
--   select count(*) from public.subscription_slots
--    where status = '활성' and rounds_confirmed_at is null;

-- ── 관리자 확정 화면이 읽는 한 줄 ────────────────────────────────────────────
--   사장님이 숫자 하나만 넣고 끝내도록, 판단 재료를 서버에서 다 모아 올린다.
--
--   핵심은 recorded_count(우리 기록)와 calendar_rounds(지금 시스템이 믿는 회차)를
--   나란히 두는 것이다. 이 둘이 벌어진 폭이 곧 이번 사고의 크기다
--   (박재우: 기록 10 · 달력 17 — 달력 쪽을 믿어서 재구독 안내가 먼저 나갔다).
--
--   택배사 송장 수는 넣지 않는다. 로젠 파일에는 구독분·홍보분·전화주문이 섞여 있어
--   '송장 N건'이 '구독 N회'라는 보장이 없다. 근거 없는 숫자를 올려 두면 사장님이
--   그걸 믿고 확정할 위험이 더 크다.
create or replace function public.admin_round_baseline_rows()
returns table (
  slot_id         bigint,
  name            text,
  phone           text,
  delivery_day    text,
  started_at      date,
  paused          boolean,
  paid_rounds     int,
  recorded_count  int,
  calendar_rounds int,
  last_ship_date  date,
  confirmed_count int,
  confirmed_at    date,
  confirmed_note  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;

  return query
  with slot_orders as (
    -- 한 구독에 묶인 모든 주문(원주문 + 재구독 연장주문).
    select s.id as sid, s.order_id as oid from public.subscription_slots s
    union
    select r.renews_slot_id, r.id from public.orders r where r.renews_slot_id is not null
  )
  select
    s.id,
    o.ship_name,
    o.ship_phone,
    s.delivery_day,
    s.started_at,
    coalesce(s.paused, false),
    t.total,
    coalesce((
      select count(distinct sl.ship_date)::int
        from public.shipment_log sl
       where sl.order_id in (select so.oid from slot_orders so where so.sid = s.id)
    ), 0),
    coalesce((
      select count(*)::int
        from public.sub_delivery_dates(
               s.started_at,
               coalesce(s.first_ship_date, s.started_at),
               t.total,
               coalesce(s.paused_days, 0)
             ) d
       where d.ship_date <= public.kst_today()
    ), 0),
    (
      select max(sl.ship_date)
        from public.shipment_log sl
       where sl.order_id in (select so.oid from slot_orders so where so.sid = s.id)
    ),
    s.rounds_confirmed_count,
    s.rounds_confirmed_at,
    s.rounds_confirmed_note
  from public.subscription_slots s
  join public.orders o on o.id = s.order_id
  cross join lateral (
    select greatest(coalesce(o.block_weeks, 0) + coalesce(s.extended_weeks, 0), 1) as total
  ) t
  where s.status = '활성'
  order by (s.rounds_confirmed_at is not null), o.ship_name;
end;
$$;

revoke all     on function public.admin_round_baseline_rows() from public;
revoke execute on function public.admin_round_baseline_rows() from anon;
grant  execute on function public.admin_round_baseline_rows() to authenticated;
