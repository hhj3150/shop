-- 배송 명단 무결성 — 정지 일수를 '주(회차) 단위'로 올려 적용 (SQL ↔ TS 동기화)
--
--   배경(실제 사고 경로):
--     정기구독은 '요일 구독'이다. 실제 발송 명단(buildRosterForDate)은 order_items.delivery_day
--     요일에 붙어 있는데, 회차 계산은 앵커(started_at) + (k-1)주 + 정지일수 로 날짜를 잡는다.
--     정지 일수가 7의 배수가 아니면 이 둘이 어긋난다.
--       예) 월요일 구독이 3일 정지 → 회차 예정일이 목요일로 이동.
--           · 손님 화면·문자의 '다음 배송일'이 실제로 받는 요일과 달라진다.
--           · 종료일(마지막 회차)이 실제 발송일과 어긋나 마지막 회차가 통째로 사라지거나
--             (회차 소실 = 결제한 회차를 못 받음) 한 회차가 더 나간다.
--           · 연장 블록 경계가 한 주 밀려 엉뚱한 구성품이 나간다(오포장).
--
--   수정:
--     p_pdays(누적 정지일)를 7의 배수로 '올려서' 쓴다. 올림이므로 종료일은 실제 정지 기간
--     이상으로만 밀리고, 총 회차는 언제나 보존된다 — 손님이 결제한 회차를 못 받는 방향으로는
--     절대 어긋나지 않는다. (1주 건너뛰기는 정확히 +7 을 적립하므로 영향이 없다.)
--
--   ⚠ lib/subscription-schedule.ts 의 ceilToWeeks 와 반드시 같은 규칙을 유지해야 한다.
--     이 함수는 cancel_subscription(환불액)·change_delivery_day(회차 보존 검증)·연장 만료일의
--     공통 기반이므로, 한쪽만 바꾸면 화면과 서버가 다른 회차를 말하게 된다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.

-- 누적 정지일 → 회차(주) 단위 올림. lib/subscription-schedule.ts ceilToWeeks 와 동일.
create or replace function public.pause_days_in_weeks(p_days int)
returns int language sql immutable set search_path = public as $$
  select ceil(greatest(coalesce(p_days, 0), 0) / 7.0)::int * 7;
$$;

-- 회차 1..p_total 의 실제 배송일. computeSchedule 과 동일 규칙.
--   p_first = subscription_slots.first_ship_date(1회차 보정일, 없으면 null).
--   p_pdays = 누적 정지일(paused_days + 정지 중이면 경과일) — 내부에서 주 단위로 올려 쓴다.
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
  v_pdays      int;
begin
  if p_anchor is null or coalesce(p_total, 0) <= 0 then return; end if;

  -- 정지 일수는 주(회차) 단위로 올려 적용한다 — 회차 예정일이 배송 요일에서 벗어나지 않게.
  v_pdays := public.pause_days_in_weeks(p_pdays);

  -- 1회차 기준일. first_ship_date 는 '앵커가 공휴일이면 다음 영업일'로 저장된 값인데,
  --   앵커가 목장 휴무일이면 그 보정값이 이월 규칙과 어긋난다 → 앵커에서 다시 계산한다.
  --   (lib/subscription-schedule.ts 의 firstBase 분기와 동일.)
  v_first_base := case
    when p_first is not null and not public.is_farm_closure(p_anchor) then p_first
    else p_anchor
  end;

  for v_i in 1..p_total loop
    if v_i = 1 then
      v_base := v_first_base + v_pdays + v_defer;
    else
      v_base := p_anchor + ((v_i - 1) * 7 + v_pdays + v_defer);
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

grant execute on function public.pause_days_in_weeks(int) to anon, authenticated;
grant execute on function public.sub_delivery_dates(date, date, int, int) to anon, authenticated;

-- 검증
--   -- 정지 없음: 월요일 앵커 → 회차가 전부 월요일(공휴일이면 다음 영업일)
--   select * from public.sub_delivery_dates('2026-06-01', null, 8, 0);
--   -- 3일 정지: 목요일로 밀리지 않고 한 주만 밀린다
--   select * from public.sub_delivery_dates('2026-06-01', null, 8, 3);
--   select public.pause_days_in_weeks(0), public.pause_days_in_weeks(3), public.pause_days_in_weeks(7),
--          public.pause_days_in_weeks(8);  -- 0, 7, 7, 14
