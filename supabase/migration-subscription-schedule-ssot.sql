-- ─────────────────────────────────────────────────────────────
-- 정기구독 회차 배송일 — SQL·TS 단일 규칙(SSOT) 정렬
--
--   [문제] 서버의 회차 계산이 `started_at + (k-1)*7 + paused_days` 뿐이라
--          주말·공휴일 시프트와 목장 휴무 이월을 전혀 반영하지 않았다.
--          클라이언트(lib/subscription-schedule.ts computeSchedule)는 반영한다 → 두 값이 갈린다.
--     · cancel_subscription   : 배송완료 회차를 과다 계산 → 해지 환불이 실제보다 적게 나간다(과소환불).
--       (예: 하계 휴무로 종료일이 한 주 밀리면 남은 회차 1건이 환불에서 누락)
--     · renewal_reminder_targets : 만료일이 실제 마지막 배송일보다 이르게 잡혀 재구독 안내가 어긋난다.
--     · confirm_payment       : 첫 배송 보정(first_ship_date)이 '다음 영업일'만 보고 휴무 이월을 모른다.
--
--   [수정] TS 규칙을 SQL 로 그대로 포팅해 한 벌의 함수로 공유한다.
--     · 회차 예정일 = 앵커(started_at) + (k-1)*7 + 누적정지일 + 누적이월일
--     · 목장 휴무로 그 주에 발송할 날이 없으면 그 회차를 '다음 주 같은 요일'로 이월하고,
--       이월분은 이후 회차 전체에 누적한다(총 회차 보존, 종료일만 밀림).
--     · 그 뒤 주말·공휴일이면 다음 영업일로 시프트한다.
--     대응 TS: lib/ship-date.ts (closureDefersWeek / closureDeferDays / subscriptionShipDate),
--              lib/subscription-schedule.ts (computeSchedule).
--
--   ★ 목장 휴무와 법정공휴일의 구분이 필요하다(공휴일 하루는 이월하지 않고 같은 주 다음
--     영업일에 발송한다 — 예: 8/17 광복절 대체공휴일 월요일분은 8/18 에 화요일분과 함께 나간다).
--     kr_holidays 에 is_farm_closure 플래그를 추가해 구분한다. lib/holidays.ts 의
--     FARM_CLOSURES 와 동일 날짜를 유지할 것(연 1회 동반 갱신).
--
-- 선행(모두 prod 적용됨):
--   kr_holidays(migration-holiday-dispatch), migration-summer-closure-2026,
--   confirm_payment 최신 정의(migration-subscription-first-holiday),
--   cancel_subscription 최신 정의(schema.sql = migration-renewal-modify 본문),
--   renewal_reminder_targets 최신 정의(migration-renewal-reminder-and-idempotency-fix).
--
-- 적용: Supabase SQL Editor 에서 이 파일을 위에서 아래로 한 번 실행. 멱등(create or replace).
-- ─────────────────────────────────────────────────────────────

begin;

-- 사전 점검 — 선행 누락이면 조용히 어긋나지 않고 즉시 중단한다.
do $$
begin
  if to_regclass('public.kr_holidays') is null then
    raise exception '선행 누락: kr_holidays — migration-holiday-dispatch.sql 먼저 적용';
  end if;
  if to_regprocedure('public.confirm_payment(text,text,integer,text,text)') is null then
    raise exception '선행 누락: confirm_payment — migration-subscription-first-holiday.sql 먼저 적용';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════
-- A) 목장 휴무 플래그 — 공휴일과 구분한다.
--    기존 행은 false(=법정공휴일) 로 남고, 하계 휴무일만 true 로 표시한다.
--    ⚠ lib/holidays.ts FARM_CLOSURES 와 동일 날짜를 유지할 것.
-- ═════════════════════════════════════════════════════════════
alter table public.kr_holidays
  add column if not exists is_farm_closure boolean not null default false;

-- 2026 하계 휴가(8/9 일 ~ 8/17 월) 중 평일 휴무분.
--   8/15(토)·8/16(일)은 주말, 8/17 은 광복절 대체공휴일(=법정공휴일)이므로 표시하지 않는다.
--   8/17 을 휴무로 표시하면 월요일 회차가 8/24 로 한 주 더 밀린다(= 8/18 합류가 깨진다).
insert into public.kr_holidays (d, is_farm_closure) values
  ('2026-08-10', true), ('2026-08-11', true), ('2026-08-12', true),
  ('2026-08-13', true), ('2026-08-14', true)
on conflict (d) do update set is_farm_closure = true;


-- ═════════════════════════════════════════════════════════════
-- B) 발송일 헬퍼 — lib/ship-date.ts 와 1:1 대응
-- ═════════════════════════════════════════════════════════════

-- 발송 불가일: 주말 또는 공휴일/목장 휴무(kr_holidays 전체).
create or replace function public.is_dispatch_blocked(p_d date)
returns boolean language sql stable set search_path = public as $$
  select extract(dow from p_d)::int in (0, 6)
      or exists (select 1 from public.kr_holidays h where h.d = p_d);
$$;

-- 목장 자체 휴무일인지(법정공휴일 제외).
create or replace function public.is_farm_closure(p_d date)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.kr_holidays h where h.d = p_d and h.is_farm_closure
  );
$$;

-- 발송 불가일이면 다음 영업일까지 전진(포함형).
create or replace function public.advance_business_day(p_d date)
returns date language plpgsql stable set search_path = public as $$
declare
  v date := p_d;
  v_guard int := 0;
begin
  while public.is_dispatch_blocked(v) and v_guard < 400 loop
    v := v + 1;
    v_guard := v_guard + 1;
  end loop;
  return v;
end;
$$;

-- 목장 휴무로 '그 주 배송이 통째로 없어지는' 회차인가.
--   회차 예정일이 목장 휴무일이고, 다음 발송 가능일이 다음 배송 주(월요일 기준)로 넘어가면 true.
--   → 그 회차는 다음 주 같은 요일로 이월한다. 공휴일 하루가 낀 경우는 false(같은 주 다음 영업일).
create or replace function public.closure_defers_week(p_d date)
returns boolean language sql stable set search_path = public as $$
  select public.is_farm_closure(p_d)
     and date_trunc('week', public.advance_business_day(p_d))
       > date_trunc('week', p_d::timestamp);
$$;

-- 회차 1..p_total 의 실제 배송일. computeSchedule 과 동일 규칙.
--   p_first = subscription_slots.first_ship_date(1회차 보정일, 없으면 null).
--   p_pdays = 누적 정지일(paused_days + 정지 중이면 경과일).
create or replace function public.sub_delivery_dates(
  p_anchor date,
  p_first  date,
  p_total  int,
  p_pdays  int
)
returns table (k int, ship_date date)
language plpgsql stable set search_path = public as $$
declare
  v_defer      int := 0;
  v_first_base date;
  v_base       date;
  v_add        int;
  v_i          int;
  v_guard      int;
begin
  if p_anchor is null or coalesce(p_total, 0) <= 0 then return; end if;

  -- 1회차 기준일. first_ship_date 는 '앵커가 공휴일이면 다음 영업일'로 저장된 값인데,
  --   앵커가 목장 휴무일이면 그 보정값이 이월 규칙과 어긋난다 → 앵커에서 다시 계산한다.
  --   (lib/subscription-schedule.ts 의 firstBase 분기와 동일.)
  v_first_base := case
    when p_first is not null and not public.is_farm_closure(p_anchor) then p_first
    else p_anchor
  end;

  for v_i in 1..p_total loop
    if v_i = 1 then
      v_base := v_first_base + coalesce(p_pdays, 0) + v_defer;
    else
      v_base := p_anchor + ((v_i - 1) * 7 + coalesce(p_pdays, 0) + v_defer);
    end if;

    -- 휴무 주 이월 — 이후 회차 전체에 누적(아니면 이월분과 다음 회차가 같은 날로 겹친다).
    v_add := 0;
    v_guard := 0;
    while public.closure_defers_week(v_base + v_add) and v_guard < 60 loop
      v_add := v_add + 7;
      v_guard := v_guard + 1;
    end loop;
    v_defer := v_defer + v_add;
    v_base  := v_base + v_add;

    k := v_i;
    ship_date := public.advance_business_day(v_base);
    return next;
  end loop;
end;
$$;

grant execute on function public.is_dispatch_blocked(date)   to anon, authenticated;
grant execute on function public.is_farm_closure(date)       to anon, authenticated;
grant execute on function public.advance_business_day(date)  to anon, authenticated;
grant execute on function public.closure_defers_week(date)   to anon, authenticated;
grant execute on function public.sub_delivery_dates(date, date, int, int) to anon, authenticated;


-- ═════════════════════════════════════════════════════════════
-- C) cancel_subscription — 배송완료 회차를 실제 배송일로 산출
--    본문 출처(라이브 최신): schema.sql. 외과적 수정 3곳만:
--      (1) first_ship_date 를 함께 조회, (2) delivered 를 sub_delivery_dates 로 산출,
--      (3) 그에 맞춘 주석. 블록 배열 구성·환불 산식·상태 전이는 100% 보존.
-- ═════════════════════════════════════════════════════════════
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
  v_uid          uuid := auth.uid();
  v_started      date;
  v_first        date;
  v_paused       boolean;
  v_paused_at    date;
  v_paused_days  int;
  v_today        date := (now() at time zone 'Asia/Seoul')::date;
  v_pdays        int;
  v_order_id     uuid;
  v_weeks_arr    int[]  := array[]::int[];
  v_prod_arr     int[]  := array[]::int[];
  v_ship_arr     int[]  := array[]::int[];
  v_from_arr     int[]  := array[]::int[];
  v_to_arr       int[]  := array[]::int[];
  v_blk          record;
  v_bw           int;
  v_prod         int;
  v_ship         int;
  v_last_prod    int := 0;
  v_last_ship    int := 0;
  v_cursor       int := 1;
  v_total        int := 0;
  v_delivered    int := 0;
  v_refund       int := 0;
  v_k            int;
  v_i            int;
begin
  select s.started_at, s.first_ship_date, s.paused, s.paused_at, s.paused_days, s.order_id
    into v_started, v_first, v_paused, v_paused_at, v_paused_days, v_order_id
    from public.subscription_slots s
   where s.id = p_slot_id
     and s.user_id = v_uid
     and s.status in ('활성','대기')
   for update of s;
  if not found then
    raise exception '해지할 수 있는 구독이 아닙니다.';
  end if;

  -- 블록 배열 구성: 원주문(=block0 고정) + 입금확인류 연장주문(created_at 순).
  --   ⚠ TS SSOT(buildRawBlocks)와 동일: 원주문 항상 먼저, 연장만 정렬.
  --     orders.id 는 random uuid(비단조) → 연장은 created_at 으로 정렬(id 는 결정적 tiebreaker).
  for v_blk in
    select o.id,
           coalesce(o.block_weeks, 0) as block_weeks,
           coalesce(o.shipping_fee, 0) as shipping_fee
      from public.orders o
     where o.id = v_order_id
        or (o.renews_slot_id = p_slot_id
            and o.status in ('입금확인','배송준비','배송중','배송완료'))
     order by case when o.id = v_order_id then 0 else 1 end, o.created_at, o.id
  loop
    v_bw := greatest(0, v_blk.block_weeks);

    select coalesce(sum(oi.unit_price * oi.qty), 0)
      into v_prod
      from public.order_items oi
     where oi.order_id = v_blk.id;

    if exists (select 1 from public.order_items oi where oi.order_id = v_blk.id) then
      -- 자기 items 보유 블록 (v_prod 는 위 select 에서 채워짐)
      v_ship := case when v_bw > 0 then round(v_blk.shipping_fee::numeric / v_bw)::int else 0 end;
      v_last_prod := v_prod;
      v_last_ship := v_ship;
    else
      -- 레거시(빈 블록) → 직전 블록 상속
      v_prod := v_last_prod;
      v_ship := v_last_ship;
    end if;

    v_weeks_arr := v_weeks_arr || v_bw;
    v_prod_arr  := v_prod_arr  || v_prod;
    v_ship_arr  := v_ship_arr  || v_ship;
    v_from_arr  := v_from_arr  || v_cursor;
    v_to_arr    := v_to_arr    || (v_cursor + v_bw);
    v_cursor    := v_cursor + v_bw;
  end loop;

  v_total := v_cursor - 1;  -- Σ block_weeks

  -- delivered := 실제 배송일(주말·공휴일 시프트 + 휴무 주 이월)이 오늘 이하인 회차 수.
  --   ★ sub_delivery_dates 는 computeSchedule 과 같은 규칙 → 화면 미리보기와 서버 환불액이 일치한다.
  --   배송일은 회차 순으로 단조 증가하므로 '오늘 이하 개수 = 연속 완료 회차'가 성립한다.
  if v_started is null then
    v_delivered := 0;
  else
    v_pdays := v_paused_days
             + case when v_paused and v_paused_at is not null
                    then greatest(0, v_today - v_paused_at) else 0 end;
    select count(*)::int into v_delivered
      from public.sub_delivery_dates(v_started, v_first, v_total, v_pdays) d
     where d.ship_date <= v_today;
  end if;

  -- 환불 := 남은 회차(delivered+1 .. total) 의 소속 블록 단가 합.
  for v_k in (v_delivered + 1)..v_total loop
    for v_i in 1..array_length(v_weeks_arr, 1) loop
      if v_k >= v_from_arr[v_i] and v_k < v_to_arr[v_i] then
        v_refund := v_refund + v_prod_arr[v_i] + v_ship_arr[v_i];
        exit;
      end if;
    end loop;
  end loop;

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


-- ═════════════════════════════════════════════════════════════
-- D) renewal_reminder_targets — 만료일 = '실제 마지막 배송일'
--    본문 출처(라이브 최신): migration-renewal-reminder-and-idempotency-fix.sql.
--    외과적 수정 1곳: expiry_date 산식만 sub_delivery_dates 의 마지막 회차 배송일로 교체.
--    (그 파일이 '알려진 잔여 오차'로 남겨둔 영업일 시프트·첫배송 보정이 이로써 해소된다.)
--    나머지(시크릿게이트·동의·입금대기 제외·dedup 원장)는 100% 보존.
-- ═════════════════════════════════════════════════════════════
create or replace function public.renewal_reminder_targets(p_secret text)
returns table (
  slot_id     bigint,
  name        text,
  phone       text,
  expiry_date date,
  sent_stages text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 시크릿 컬럼을 별칭(ds)으로 명시 — RETURNS TABLE 출력변수 name 과의 모호성 제거
  select ds.decrypted_secret into v_expected
    from vault.decrypted_secrets ds
   where ds.name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
  with computed as (
    select s.id as slot_id,
           p.name as name,
           p.phone as phone,
           -- 마지막 배송일 = 총회차째 실제 배송일(영업일 시프트·휴무 이월 반영).
           --   계정 페이지 computeSchedule.endDate 와 동일 값.
           (select d.ship_date
              from public.sub_delivery_dates(
                     s.started_at,
                     s.first_ship_date,
                     greatest(o.block_weeks + s.extended_weeks, 1),
                     s.paused_days
                   ) d
             order by d.k desc
             limit 1) as expiry_date
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       and p.marketing_consent = true
       and not exists (
         select 1 from public.orders r
          where r.renews_slot_id = s.id and r.status = '입금대기'
       )
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from computed c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between v_today and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$$;

revoke all on function public.renewal_reminder_targets(text) from public;
grant execute on function public.renewal_reminder_targets(text) to anon;


-- ═════════════════════════════════════════════════════════════
-- E) confirm_payment — 첫 배송 보정에 휴무 이월 반영
--    본문 출처(라이브 최신): migration-subscription-first-holiday.sql.
--    외과적 수정 1곳: step 7 의 first_ship_date 계산(while 루프)을 sub_delivery_dates 1회차로 교체.
--    앵커(started_at = 선택 요일)는 그대로 — 2회차+ cadence 기준이라 보정하면 주기가 깨진다.
-- ═════════════════════════════════════════════════════════════
create or replace function public.confirm_payment(
  p_order_no    text,
  p_secret      text,
  p_paid_amount integer,
  p_pay_method  text default null,
  p_pg_tx_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected         text;
  v_order            record;
  v_slot             record;
  v_target           int;
  v_start            date;
  v_first            date;
  v_day_num          jsonb := '{"mon":1,"tue":2,"wed":3,"thu":4,"fri":5}'::jsonb;
  v_orphan_inserted  int := 0;
begin
  -- 1) 공유 시크릿 검증 (웹훅만 통과). 시크릿은 Vault에 보관 → 레포에 없음.
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  -- 2) 주문 조회 + 행 잠금 (동시 웹훅 재시도 대비)
  select * into v_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'order_not_found'; end if;

  -- 3) 금액 재검증 (서버 권위값과 일치해야 입금확인)
  if p_paid_amount is null or p_paid_amount <> v_order.total_amount then
    raise exception 'amount_mismatch: paid=% expected=%', p_paid_amount, v_order.total_amount;
  end if;

  -- 4) 멱등: 이미 '입금대기'가 아니면 변경 없이 현재 상태 반환.
  --    단, '취소'된 주문에 입금이 들어온 경우(고아입금)는 원장에 적재하고, '이번에 처음 적재됐을 때만'
  --    orphan_inserted=true 로 알린다(웹훅 재전송 중복 알림 방지).
  if v_order.status <> '입금대기' then
    if v_order.status = '취소' then
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, v_order.status
        )
      on conflict (order_no, pg_tx_id) do nothing;
      get diagnostics v_orphan_inserted = row_count;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', v_order.status, 'changed', false,
        'orphan', true, 'orphan_inserted', (v_orphan_inserted > 0),
        'order_type', v_order.order_type,
        'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
      );
    end if;
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', v_order.status, 'changed', false,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
    );
  end if;

  -- 5) 연장 주문: 주문 결제기록 + 슬롯 측(좌석 이동 + extended_weeks 누적)은 공유 헬퍼에 위임.
  if v_order.renews_slot_id is not null then
    update public.orders
       set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
     where id = v_order.id;
    perform public.apply_renewal_slot_change(v_order.id);
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', '입금확인', 'changed', true,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
      'ship_date', v_order.ship_date
    );
  end if;

  -- 6) 일반 주문: 상태 입금확인 + 결제 기록
  update public.orders
     set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
   where id = v_order.id;

  -- 7) 구독 주문이면 슬롯 활성화 (신청 → 활성).
  --    started_at = 선택 요일 앵커(첫 배송 요일, KST). 2회차+ cadence 기준이라 보정하지 않는다.
  --    first_ship_date = 1회차 실제 배송일(주말·공휴일 → 다음 영업일, 목장 휴무 주 → 다음 주
  --      같은 요일). 앵커와 같으면 null(보정 불필요) — 기존 컬럼 의미 그대로.
  if v_order.order_type = '구독' then
    for v_slot in
      select id, delivery_day from public.subscription_slots
       where order_id = v_order.id and status = '신청'
    loop
      v_target := (v_day_num ->> v_slot.delivery_day)::int;
      v_start  := (now() at time zone 'Asia/Seoul')::date + 1;
      while extract(dow from v_start)::int <> v_target loop
        v_start := v_start + 1;
      end loop;
      select d.ship_date into v_first
        from public.sub_delivery_dates(v_start, null, 1, 0) d;
      update public.subscription_slots
         set status = '활성',
             started_at = v_start,
             first_ship_date = case when v_first <> v_start then v_first else null end
       where id = v_slot.id;
    end loop;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', '입금확인', 'changed', true,
    'order_type', v_order.order_type,
    'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
    'ship_date', v_order.ship_date
  );
end;
$$;

grant execute on function public.confirm_payment(text, text, integer, text, text) to anon, authenticated;

commit;


-- ───────── 사장님 적용 절차 ─────────
-- 1) 이 파일을 Supabase SQL Editor 에 붙여넣고 한 번 실행(A→E 순서 그대로).
-- 2) 검증 — 아래 쿼리 결과가 주석과 같으면 정상.
--
--   a) 휴무 플래그
--      select d, is_farm_closure from public.kr_holidays
--       where d between '2026-08-10' and '2026-08-17' order by d;
--      → 8/10~8/14 = true, 8/15·8/17 = false (8/17 은 법정공휴일)
--
--   b) 요일별 하계 휴무 배송일 (앵커는 7월 첫 주 각 요일)
--      select a.day,
--             (select array_agg(d.ship_date order by d.k)
--                from public.sub_delivery_dates(a.anchor, null, 8, 0) d) as ships
--        from (values ('월','2026-07-06'::date), ('화','2026-07-07'), ('수','2026-07-08'),
--                     ('목','2026-07-09'), ('금','2026-07-10')) as a(day, anchor);
--      → 월: … 08-03, 08-18, 08-24, 08-31      (8/10·8/17 회차가 겹치지 않음)
--        화: … 08-04, 08-18, 08-25, 09-01      (월요일분과 8/18 에 함께)
--        수: … 08-05, 08-19, 08-26, 09-02
--        목: … 08-06, 08-20, 08-27, 09-03
--        금: … 08-07, 08-21, 08-28, 09-04
--      ⚠ 8/10~8/14, 8/17 이 결과에 하나도 없어야 한다(휴무 중 발송 없음).
--
--   c) 회차 중복 없음(회차 소실 가드) — 각 요일 12회차 배송일이 모두 달라야 한다.
--      select a.anchor,
--             count(*) as rows, count(distinct d.ship_date) as distinct_days
--        from (values ('2026-07-06'::date),('2026-07-07'),('2026-07-08'),
--                     ('2026-07-09'),('2026-07-10')) as a(anchor),
--             lateral public.sub_delivery_dates(a.anchor, null, 12, 0) d
--       group by a.anchor;
--      → rows = distinct_days = 12 (전부)
--
--   d) 공휴일 하루는 이월하지 않는다(기존 동작 보존)
--      select public.closure_defers_week('2026-05-05') as childrens_day,  -- false
--             public.closure_defers_week('2026-08-12') as summer_closure; -- true
--
--   e) 해지 환불 대조 — 하계 휴무를 지나는 활성 구독 1건을 골라
--      계정 페이지의 '환불 예상액'(lib refundAmount)과 cancel_subscription 반환값이 같은지 확인.
--      (수정 전에는 휴무로 종료일이 밀린 만큼 서버가 1회차 적게 환불했다.)
