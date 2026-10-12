-- 일시정지 회차 밀림 수정 — 정지 보정의 기준을 '경과 일수'에서 '놓친 회차 수'로 바꾼다.
--
--   [문제] 정지 보정이 `pause_days_in_weeks(경과 일수)` = 경과 일수를 주 단위로 올린 값이었다.
--     이 값이 모든 회차 예정일을 한꺼번에 미는데, '경과 일수'와 '실제로 못 받은 회차'는 다르다.
--       · 화요일 구독이 수요일에 정지 → 금요일 재개. 놓친 배송은 0회인데 경과 2일이 1주로
--         올림돼 전 회차가 한 주 밀린다. 손님은 회차 하나를 공짜로 얻고, 종료일·연장 블록
--         경계가 어긋나며, 해지하면 받지도 않은 회차까지 환불된다.
--       · 반대로 휴배송 주(추석·하계휴무)를 끼고 정지하면, 그 주는 원래 배송이 없는 주인데도
--         정지 1주로 계산돼 손님이 결제한 회차를 한 번 덜 받는다.
--       · 정지 중에는 경과 일수가 매일 늘어 올림 경계를 넘을 때마다 회차·종료일이 들썩였다.
--
--   [수정] 정지 구간에 '실제로 놓인 배송 예정일'만 센다 — 그 수 × 7일이 정지 보정값이다.
--     휴배송 주는 세지 않고, 배송이 끼지 않은 짧은 정지는 0주다. 정지 중 화면의 회차가
--     그대로 멈추고, 재개 시 적립되는 주 수와도 정확히 맞물린다.
--
--   구간 규칙(양쪽이 정확히 맞물리게):
--     · 정지 중 조회·해지: [정지일, 오늘] — 정지 슬롯은 그날 배송명단에서 빠지므로 오늘 포함.
--     · 재개: [정지일, 재개일) — 재개일 당일은 이미 정지가 풀려 정상 발송되므로 제외.
--
--   ⚠ lib/subscription-schedule.ts(computeSchedule) 와 반드시 같은 규칙을 유지한다.
--     화면과 서버가 다른 회차를 말하면 환불액·배송명단·연장 블록 경계가 갈린다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-weekly-ship-rule.sql(sub_delivery_dates), migration-skip-week.sql,
--         migration-renewal-modify.sql(cancel_subscription 블록 환불).

do $$
begin
  if to_regprocedure('public.sub_delivery_dates(date,date,int,int)') is null then
    raise exception '선행 누락: sub_delivery_dates — migration-weekly-ship-rule.sql 먼저 적용';
  end if;
end $$;


-- ── 1) 정지 구간에 놓인 회차 수 ──────────────────────────────────────────
--   p_from(포함) ~ p_to(제외) 사이에 놓이는 배송 예정일의 개수.
--   스케줄은 '정지 전까지 확정된 정지일수(slots.paused_days)' 기준으로 뽑는다 — 진행 중인
--   정지분을 넣으면 자기 자신을 참조하게 된다.
--
--   ★ 스케줄은 총 회차(p_total)보다 길게 뽑아서 센다. 남은 회차가 정지 구간보다 짧으면
--     (예: 3회 남기고 6주 정지) 총 회차까지만 센 수가 정지 기간보다 모자라, 밀어낸 회차
--     예정일이 여전히 과거에 머문다 → 정지 중인데 배송 완료 수가 다시 늘고, 재개하면 남은
--     회차가 한꺼번에 '이미 배송됨'으로 삼켜진다. 요일 cadence 는 회차 수와 무관하므로
--     구간을 덮을 만큼만 더 뽑으면 된다(휴배송 주는 그 주에 자리가 없어 자연히 빠진다).
create or replace function public.missed_delivery_weeks(
  p_anchor date,
  p_first  date,
  p_total  int,
  p_pdays  int,
  p_from   date,
  p_to     date
)
returns integer language sql stable set search_path = public as $$
  select coalesce((
    select count(*)::int
      from public.sub_delivery_dates(
             p_anchor, p_first,
             greatest(coalesce(p_total, 0), 0)
               + ceil(greatest(p_to - p_from, 0) / 7.0)::int + 2,
             p_pdays
           ) d
     where d.ship_date >= p_from
       and d.ship_date <  p_to
  ), 0);
$$;

grant execute on function public.missed_delivery_weeks(date, date, int, int, date, date)
  to anon, authenticated;


-- ── 2) 재개 — 놓친 회차 × 7일만 적립 ────────────────────────────────────
create or replace function public.resume_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started   date;
  v_first     date;
  v_paused_at date;
  v_pdays     int;
  v_total     int;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
  v_missed    int;
begin
  select s.started_at, s.first_ship_date, s.paused_at, s.paused_days,
         greatest(coalesce(o.block_weeks, 0) + coalesce(s.extended_weeks, 0), 1)
    into v_started, v_first, v_paused_at, v_pdays, v_total
    from public.subscription_slots s
    left join public.orders o on o.id = s.order_id
   where s.id = p_slot_id
     and s.user_id = auth.uid()
     and s.paused = true
     and s.paused_at is not null
   for update of s;
  if not found then
    raise exception '재개할 수 있는 정지 상태가 아닙니다.';
  end if;

  -- 재개일 당일은 정상 발송된다 → [정지일, 재개일).
  v_missed := public.missed_delivery_weeks(
    v_started, v_first, v_total, v_pdays, v_paused_at, v_today
  );

  update public.subscription_slots
     set paused         = false,
         paused_days    = paused_days + v_missed * 7,
         paused_at      = null,
         skip_resume_on = null
   where id = p_slot_id;
end;
$$;

grant execute on function public.resume_subscription(bigint) to authenticated;


-- ── 3) 건너뛰기 자동재개(cron) — 같은 규칙으로 적립 ──────────────────────
--   건너뛰기는 '다음 배송일 하나만 거르는' 정지라 보통 1회(=7일)가 적립된다.
--   cron 이 하루 늦게 돌아도 그 사이에 배송 예정일이 없으므로 결과는 같다.
create or replace function public.auto_resume_skips(p_secret text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_count    integer;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  update public.subscription_slots s
     set paused         = false,
         paused_days    = s.paused_days + public.missed_delivery_weeks(
                            s.started_at, s.first_ship_date,
                            greatest(coalesce(o.block_weeks, 0)
                                     + coalesce(s.extended_weeks, 0), 1),
                            s.paused_days, s.paused_at, v_today
                          ) * 7,
         paused_at      = null,
         skip_resume_on = null
    from public.orders o
   where o.id = s.order_id
     and s.paused = true
     and s.paused_at is not null
     and s.skip_resume_on is not null
     and s.skip_resume_on <= v_today;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.auto_resume_skips(text) to anon;


-- ── 4) 해지 환불 — 진행 중인 정지도 '놓친 회차' 기준으로 ─────────────────
--   기존에는 `paused_days + (오늘 - 정지일)` 로 경과 일수를 그대로 더해, 배송이 끼지 않은
--   정지가 회차를 한 주 밀어 손님이 받지 않은 회차까지 환불되거나(과다 환불),
--   휴배송 주를 낀 정지가 회차를 깎아 환불이 모자랐다.
--   해지 시점에는 아직 정지 중이므로 오늘 회차도 못 받는다 → [정지일, 오늘+1).
create or replace function public.cancel_subscription(
  p_slot_id bigint,
  p_reason text,
  p_refund_account text
)
returns integer
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
    -- 진행 중인 정지는 '놓친 회차 × 7일'로 환산한다(경과 일수 올림이 아니다).
    v_pdays := v_paused_days
             + case when v_paused and v_paused_at is not null
                    then public.missed_delivery_weeks(
                           v_started, v_first, v_total, v_paused_days,
                           v_paused_at, v_today + 1
                         ) * 7
                    else 0 end;
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


-- ── 5) 옛 3인자 missed_delivery_weeks 제거 ───────────────────────────────
--   '앵커 요일이 정지 구간에 몇 번 들어갔나'만 세던 버전. 휴배송 주를 구분하지 못해
--   추석·하계휴무를 낀 정지에서 회차를 깎았다. 위 함수들이 모두 6인자판을 쓰므로 제거한다.
drop function if exists public.missed_delivery_weeks(date, date, date);


-- 검증
--   -- 배송이 끼지 않은 짧은 정지 → 0주 (월요일 구독, 수 정지 → 금 재개)
--   select public.missed_delivery_weeks('2026-06-01', null, 4, 0, '2026-06-03', '2026-06-05');  -- 0
--   -- 배송 1회가 낀 정지 → 1주
--   select public.missed_delivery_weeks('2026-06-01', null, 4, 0, '2026-06-03', '2026-06-10');  -- 1
--   -- 추석 휴배송 주(9/21~25)는 정지로 세지 않는다 (화요일 구독, 앵커 06-16 + 확정 28일)
--   select public.missed_delivery_weeks('2026-06-16', null, 12, 28, '2026-09-17', '2026-09-24'); -- 0
--   select public.missed_delivery_weeks('2026-06-16', null, 12, 28, '2026-09-17', '2026-09-30'); -- 1
--   -- 남은 회차보다 긴 정지도 주 수만큼 계속 적립된다 (12회 중 9회 받고 08-10 정지)
--   select public.missed_delivery_weeks('2026-06-09', null, 12, 0, '2026-08-10', '2026-09-19'); -- 5
