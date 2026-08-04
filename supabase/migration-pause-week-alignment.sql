-- ─────────────────────────────────────────────────────────────
-- 정기구독 — 일시정지 적립을 주 단위로 정렬 + 회차 충돌 가드
--
--   [문제 1] resume_subscription 이 정지 일수를 '달력 일수 그대로' 적립한다
--            (paused_days += current_date - paused_at). 7의 배수가 아니면 회차 예정일이
--            앵커 요일에서 밀린다 — 화요일 구독이 토요일 예정일이 되는 식이다.
--
--     그런데 실제 발송(관리자 배송 명단 buildRosterForDate)과 전날 예고 문자(ship-reminder)는
--     주문의 delivery_day '요일'로 날짜를 잡는다(deliveryDayHitsDate). 요일은 정지로 바뀌지
--     않는다 → 계정 페이지·환불 계산(computeSchedule)만 혼자 다른 날짜를 말하게 된다.
--
--     실측(슬롯 39, 화요일 구독, paused_days=11):
--       · 실제 발송(shipment_log) : 06-16, 07-07, 07-14, 07-28, 08-04 — 전부 화요일
--       · computeSchedule 주장    : 06-29, 07-06, 07-13 …          — 전부 월요일
--     발송·문자가 사실이고 계정 화면이 허구였다. 요일 cadence 를 진실로 삼아 정렬한다.
--
--   [문제 2] 위 드리프트가 겹치면 회차가 사라진다. 예정일이 주말이면 목장 휴무일이 아니라
--            '휴무 주 이월'(closure_defers_week) 판정을 그냥 통과하고, advance_business_day 가
--            연속 두 회차를 휴무 주 너머 같은 영업일로 밀어버린다.
--       슬롯 39: 7·8회차 예정일 8/8·8/15(토) → 둘 다 8/18 로 뭉개짐 → 12회 결제, 11회 배송.
--
--   [수정]
--     A) missed_delivery_weeks(앵커, 시작, 끝) — 정지 구간에 실제로 걸린 '배송 요일' 횟수.
--     B) resume_subscription — 적립 = 거른 회차 수 × 7. 요일이 절대 밀리지 않는다.
--        (auto_resume_skips 의 '정확히 1회분(7일)' 적립과 같은 원칙을 일반 정지로 일반화.)
--        pause/resume 의 기준일을 KST 로 맞춘다 — DB TimeZone 이 UTC 라 current_date 는
--        KST 00~09시에 하루 뒤처진다(cancel_subscription·renewal_reminder_targets 와 동일 기준).
--     C) sub_delivery_dates — 회차 충돌 가드. 배송일이 직전 회차보다 뒤가 될 때까지 주 단위로
--        더 이월하고 그 이월분을 이후 회차에 누적한다. 휴무 케이스도 이 규칙에 포섭되며,
--        배송일이 단조 증가하므로 반드시 종료한다. B) 로 정렬된 정상 상태에서는 발동하지 않는
--        안전망이다. 대응 TS: lib/subscription-schedule.ts computeSchedule.
--     D) 슬롯 39 백필 — 정지로 실제 거른 배송은 06-23·06-30 두 회차 → 11 이 아니라 14.
--
-- 선행: migration-subscription-schedule-ssot.sql (prod 적용됨), migration-skip-week.sql.
-- 적용: Supabase SQL Editor 에서 이 파일을 위에서 아래로 한 번 실행. 멱등.
-- ─────────────────────────────────────────────────────────────

begin;

do $$
begin
  if to_regprocedure('public.sub_delivery_dates(date,date,integer,integer)') is null then
    raise exception '선행 누락: sub_delivery_dates — migration-subscription-schedule-ssot.sql 먼저 적용';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════
-- A) 정지 구간에 실제로 걸린 배송 회차 수
--    배송은 앵커(started_at) 요일에 나간다. [p_from, p_to) 안의 그 요일 횟수가
--    '정지로 거른 회차 수'다. 로스터가 정지 중 슬롯을 그 요일에 제외하는 것과 정확히 대응한다.
--    (하한 포함 = 정지 당일 발송분도 제외됨 / 상한 제외 = 재개 당일 발송분은 나감.)
-- ═════════════════════════════════════════════════════════════
create or replace function public.missed_delivery_weeks(
  p_anchor date,
  p_from   date,
  p_to     date
)
returns int language sql stable set search_path = public as $$
  select coalesce((
    select count(*)::int
      from generate_series(p_from, p_to - 1, interval '1 day') g(d)
     where extract(dow from g.d) = extract(dow from p_anchor)
  ), 0);
$$;

grant execute on function public.missed_delivery_weeks(date, date, date) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- B) 일시정지 — 기준일 KST 통일, 재개 적립은 주 단위
-- ═════════════════════════════════════════════════════════════
create or replace function public.pause_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

-- 재개: 적립 = 정지 구간에 거른 회차 수 × 7.
--   달력 일수를 그대로 적립하면 배송 요일이 밀려 발송 명단·예고 문자와 어긋난다(위 [문제 1]).
--   앵커가 없으면(미시작) 적립 0 — 시작 전 정지는 회차를 거르지 않는다.
create or replace function public.resume_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_started   date;
  v_paused_at date;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
  v_missed    int;
begin
  select s.started_at, s.paused_at
    into v_started, v_paused_at
    from public.subscription_slots s
   where s.id = p_slot_id
     and s.user_id = auth.uid()
     and s.paused = true
     and s.paused_at is not null
   for update of s;
  if not found then
    raise exception '재개할 수 있는 정지 상태가 아닙니다.';
  end if;

  v_missed := public.missed_delivery_weeks(v_started, v_paused_at, v_today);

  update public.subscription_slots
     set paused = false,
         paused_days = paused_days + v_missed * 7,
         paused_at = null,
         skip_resume_on = null   -- 건너뛰기 상태에서 일반 재개가 와도 stale 값이 남지 않게
   where id = p_slot_id;
end;
$$;

grant execute on function public.pause_subscription(bigint)  to authenticated;
grant execute on function public.resume_subscription(bigint) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- C) sub_delivery_dates — 회차 충돌 가드 추가
--    lib/subscription-schedule.ts computeSchedule 과 1:1 대응(같은 순서·같은 가드 상한).
-- ═════════════════════════════════════════════════════════════
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
  v_scheduled  date;
  v_base       date;
  v_ship       date;
  v_prev       date := null;
  v_extra      int;
  v_closure    int;
  v_guard      int;
  v_i          int;
begin
  if p_anchor is null or coalesce(p_total, 0) <= 0 then return; end if;

  -- 1회차 기준일. first_ship_date 는 '앵커가 공휴일이면 다음 영업일'로 저장된 값인데,
  --   앵커가 목장 휴무일이면 그 보정값이 이월 규칙과 어긋난다 → 앵커에서 다시 계산한다.
  v_first_base := case
    when p_first is not null and not public.is_farm_closure(p_anchor) then p_first
    else p_anchor
  end;

  for v_i in 1..p_total loop
    -- 이 회차의 앵커 기준 예정일(누적 이월 전).
    if v_i = 1 then
      v_scheduled := v_first_base + coalesce(p_pdays, 0);
    else
      v_scheduled := p_anchor + ((v_i - 1) * 7 + coalesce(p_pdays, 0));
    end if;

    v_extra := 0;
    v_guard := 0;
    loop
      v_base := v_scheduled + v_defer + v_extra;

      -- 휴무 주 이월 — 연속 휴무 주에도 안전하도록 반복.
      v_closure := 0;
      while public.closure_defers_week(v_base + v_closure) and v_closure < 420 loop
        v_closure := v_closure + 7;
      end loop;

      v_ship := public.advance_business_day(v_base + v_closure);

      -- 직전 회차와 같은 날(또는 그 이전)이면 한 주 더 이월하고 다시 계산.
      exit when v_prev is null or v_ship > v_prev or v_guard >= 60;
      v_extra := v_extra + 7;
      v_guard := v_guard + 1;
    end loop;

    -- 이월분(휴무 + 충돌 회피)은 이후 회차 전체에 누적한다.
    v_defer := v_defer + v_extra + v_closure;
    v_prev  := v_ship;

    k := v_i;
    ship_date := v_ship;
    return next;
  end loop;
end;
$$;

grant execute on function public.sub_delivery_dates(date, date, int, int) to anon, authenticated;


-- ═════════════════════════════════════════════════════════════
-- E) 이번 주 건너뛰기 — 같은 규칙으로 정렬
--    auto_resume_skips 는 '정확히 1회분' 이라며 7일을 고정 적립한다. 그런데 건너뛰기는
--    신청 즉시 paused=true 가 되고 skip_resume_on 까지 정지가 유지된다 → 정지 구간이 배송
--    요일을 두 번 지나면 두 회차가 빠지는데 적립은 7일뿐이라 한 회차가 사라진다.
--
--    실제 사례(슬롯 51, 수요일 구독): paused_at=07-28, skip_resume_on=08-06.
--      정지 구간 [07-28, 08-06) 에 수요일이 07-29·08-05 두 번 → 2회차가 빠지는데 적립은 7일.
--      (신청은 KST 07-29 새벽인데 DB TimeZone 이 UTC 라 paused_at 이 07-28 로 찍혔다.
--       클라이언트는 KST 기준 다음 배송일 08-05 를 건너뛸 대상으로 넘겼다 → 07-29 은 덤으로 빠졌다.)
--
--    → 적립을 missed_delivery_weeks 로 통일하고, skip_next_delivery 의 기준일도 KST 로 맞춘다.
--      cron 실행이 늦어져도 정지가 유지된 만큼만 정확히 적립된다(로스터 제외 구간과 정확히 대응).
-- ═════════════════════════════════════════════════════════════
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
     set paused = false,
         -- 정지 구간에 실제로 걸린 회차 수 × 7 (기존 고정 +7 은 두 회차가 빠진 경우를 놓쳤다).
         paused_days = s.paused_days
                     + public.missed_delivery_weeks(s.started_at, s.paused_at, v_today) * 7,
         paused_at = null,
         skip_resume_on = null
   where s.paused = true
     and s.skip_resume_on is not null
     and s.skip_resume_on <= v_today;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.skip_next_delivery(bigint, date) to authenticated;
grant execute on function public.auto_resume_skips(text) to anon;


-- ═════════════════════════════════════════════════════════════
-- D) 백필 — 드리프트한 기존 슬롯을 주 단위로 정렬
--    슬롯 39(화요일 구독, 앵커 2026-06-16): 정지로 실제 거른 배송은 06-23·06-30 두 회차.
--    shipment_log 로 확인 — 그 두 화요일에만 발송이 없고 07-07 부터 재개됐다.
--    → 적립은 11 이 아니라 14. 이로써 computeSchedule 이 실제 화요일 cadence 를 재현한다.
--    현재 값(11)을 조건에 넣어 재실행해도 두 번 적용되지 않게 한다.
update public.subscription_slots
   set paused_days = 14
 where id = 39
   and started_at = '2026-06-16'
   and paused_days = 11;

-- 남은 드리프트가 없어야 한다 — 있으면 즉시 중단하고 사람이 판단한다.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.subscription_slots
   where status in ('활성','대기') and paused_days % 7 <> 0;
  if v_bad > 0 then
    raise exception '주 단위로 정렬되지 않은 활성 슬롯 % 건 — 백필 대상 확인 필요', v_bad;
  end if;
end $$;

commit;


-- ───────── 사장님 적용 절차 ─────────
-- 1) 이 파일을 Supabase SQL Editor 에 붙여넣고 한 번 실행(A→D 순서 그대로).
-- 2) 검증 — 아래 결과가 주석과 같으면 정상.
--
--   a) 회차 소실이 없다 — 활성/대기 슬롯 전체에서 배송일 중복 0
--      select count(*) as slots_with_dupes from (
--        select s.id
--          from public.subscription_slots s
--          join public.orders o on o.id = s.order_id
--          cross join lateral public.sub_delivery_dates(
--                 s.started_at, s.first_ship_date,
--                 greatest(o.block_weeks + coalesce(s.extended_weeks,0), 1),
--                 s.paused_days) d
--         where s.status in ('활성','대기') and s.started_at is not null
--         group by s.id
--        having count(*) <> count(distinct d.ship_date)) t;
--      → 0
--
--   b) 슬롯 39 가 실제 화요일 cadence 를 재현한다
--      select array_agg(d.ship_date order by d.k)
--        from public.sub_delivery_dates('2026-06-16', null, 12, 14) d;
--      → {06-30, 07-07, 07-14, 07-21, 07-28, 08-04, 08-18, 08-25, 09-01, 09-08, 09-15, 09-22}
--        (8/18 은 하계 휴무 이월 도착일 — 나머지는 전부 화요일)
--
--   c) 재개 적립이 주 단위다
--      select public.missed_delivery_weeks('2026-06-16','2026-06-20','2026-07-01'); -- 2 (→ 14일)
--      select public.missed_delivery_weeks('2026-06-16','2026-07-20','2026-07-22'); -- 1 (→  7일)
--      select public.missed_delivery_weeks('2026-06-16','2026-07-22','2026-07-24'); -- 0 (거른 회차 없음)
--
--   d) 건너뛰기 중인 슬롯이 받게 될 적립 — 정지 구간에 배송 요일이 두 번 들면 14일이어야 한다.
--      select s.id, to_char(s.started_at,'Dy') as 요일, s.paused_at, s.skip_resume_on,
--             public.missed_delivery_weeks(s.started_at, s.paused_at,
--               greatest(s.skip_resume_on, (now() at time zone 'Asia/Seoul')::date)) * 7 as 적립일
--        from public.subscription_slots s
--       where s.paused and s.skip_resume_on is not null order by s.id;
--      → 수정 전에는 전부 7 이었다. 배송 요일이 두 번 걸린 슬롯은 14 가 나와야 정상.
--
--   e) 계정·환불(computeSchedule)과 발송 명단·예고 문자가 같은 날짜를 내는지
--      → lib/schedule-consistency.test.ts 가 전 요일 × 정지 0/7/14/28일에 대해 검증한다.
--        (npx vitest run lib/schedule-consistency.test.ts)
