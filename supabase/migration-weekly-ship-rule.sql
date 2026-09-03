-- 발송일 규칙 일반화 — 「한 회차는 그 주(월~금)를 벗어나지 않는다」 + 2026 추석 주 휴배송
--
--   배경:
--     정기구독은 요일 구독이다. 지금까지 공휴일이 끼면 무조건 '다음 영업일'로 밀었는데,
--     연휴가 길면 그 회차가 다음 주로 넘어가 두 가지가 동시에 깨진다.
--       · 연휴 직후 하루에 여러 요일분이 몰린다(2026 추석: 9/29 하루에 월·화·목·금 4개 그룹).
--       · 그 다음 회차와 간격이 무너진다(목요일 손님: 12일 공백 뒤 이틀 만에 또 배송).
--
--   새 규칙(lib/ship-date.ts shipDateInWeek 와 1:1):
--     ① 그날 발송 가능        → 그날
--     ② 같은 주 뒤쪽에 영업일  → 가장 이른 그 날 (미루기)
--         예) 2026-10-05(월, 개천절 대체) → 10-06(화). 화요일분과 함께 나간다.
--     ③ 같은 주 앞쪽에 영업일  → 가장 늦은 그 날 (앞당김)
--         예) 2026-10-09(금, 한글날) → 10-08(목). 목요일분과 함께 나간다.
--             (뒤로 밀면 10-12 월요일 — 주를 넘어 간격이 10일·4일로 무너진다.)
--     ④ 그 주에 영업일이 없음  → 휴배송, 다음 주 같은 요일로 이월(총 회차 보존, 종료일 +1주)
--     ★ 1회차만 예외: 앞당기지 않는다. 앵커는 '입금확인 다음 날 이후'라 앞당기면 아직
--       발송할 수 없는(이미 지난) 날이 된다 → 그 회차는 다음 주로 미룬다.
--
--   ⚠ lib/ship-date.ts · lib/subscription-schedule.ts 와 반드시 같은 규칙을 유지한다.
--     이 함수는 cancel_subscription(환불액)·change_delivery_day(회차 보존 검증)·연장 만료일의
--     공통 기반이므로, 한쪽만 바꾸면 화면과 서버가 다른 회차를 말하게 된다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-subscription-schedule-ssot.sql, migration-roster-weekday-integrity.sql

-- ── 1) 2026 추석 연휴 주(9/21~9/25) 휴배송 등록 ──────────────────────────
--   추석 연휴는 9/24(목)~9/28(월 대체공휴일). 연휴 직후 첫 영업일(9/29)에 그 주 회차를 모아
--   보내면 네 요일분이 하루에 몰리고(평소 4배 물량), 추석 직후 택배 물량 피크와 겹쳐
--   신선도가 깨진다. → 그 주를 통째로 쉬고 전 요일을 다음 주 같은 요일로 이월한다.
--   재개: 월 9/29(화, 9/28 대체공휴일 시프트) · 화 9/29 · 수 9/30 · 목 10/1 · 금 10/2.
--   ⚠ lib/holidays.ts 의 FARM_CLOSURES 와 동일 날짜를 유지한다.
insert into public.kr_holidays (d, is_farm_closure) values
  ('2026-09-21', true), ('2026-09-22', true), ('2026-09-23', true),
  ('2026-09-24', true), ('2026-09-25', true)
on conflict (d) do update set is_farm_closure = true;


-- ── 2) 회차 예정일 → 그 주 안에서의 실제 발송일 ──────────────────────────
--   그 주에 발송할 날이 하루도 없으면 null(= 휴배송, 다음 주 같은 요일로 이월).
create or replace function public.ship_date_in_week(p_d date)
returns date language plpgsql stable set search_path = public as $$
declare
  v_mon date;
  v_idx int;
  v_i   int;
  v_c   date;
begin
  if p_d is null then return null; end if;
  v_idx := extract(isodow from p_d)::int;         -- 1=월 … 7=일
  if v_idx > 5 then return null; end if;          -- 정기 회차 기준일은 평일만
  v_mon := p_d - (v_idx - 1);

  if not public.is_dispatch_blocked(p_d) then return p_d; end if;   -- ①

  for v_i in (v_idx + 1)..5 loop                                    -- ② 미루기
    v_c := v_mon + (v_i - 1);
    if not public.is_dispatch_blocked(v_c) then return v_c; end if;
  end loop;

  for v_i in reverse (v_idx - 1)..1 loop                            -- ③ 앞당김
    v_c := v_mon + (v_i - 1);
    if not public.is_dispatch_blocked(v_c) then return v_c; end if;
  end loop;

  return null;                                                      -- ④ 그 주 휴배송
end;
$$;

-- 그 주에 발송할 수 있는 날이 없어 회차가 통째로 다음 주로 이월되는가.
create or replace function public.closure_defers_week(p_d date)
returns boolean language sql stable set search_path = public as $$
  select public.ship_date_in_week(p_d) is null;
$$;


-- ── 3) 회차 1..p_total 의 실제 배송일 ───────────────────────────────────
--   p_first(subscription_slots.first_ship_date)는 더 이상 쓰지 않는다 — 옛 규칙
--   ('앵커가 공휴일이면 다음 영업일')로 저장된 값이라 앞당김·휴배송이 들어간 지금 규칙과
--   어긋난다. 1회차도 앵커에서 같은 규칙으로 산출한다. 시그니처는 호환을 위해 유지.
create or replace function public.sub_delivery_dates(
  p_anchor date,
  p_first  date,
  p_total  int,
  p_pdays  int
)
returns table (k int, ship_date date)
language plpgsql stable set search_path = public as $$
declare
  v_defer int := 0;
  v_pdays int;
  v_base  date;
  v_ship  date;
  v_i     int;
  v_guard int;
begin
  if p_anchor is null or coalesce(p_total, 0) <= 0 then return; end if;

  -- 정지 일수는 주(회차) 단위로 올려 적용한다 — 회차 예정일이 배송 요일에서 벗어나지 않게.
  v_pdays := public.pause_days_in_weeks(p_pdays);

  for v_i in 1..p_total loop
    v_base := p_anchor + ((v_i - 1) * 7 + v_pdays + v_defer);
    v_guard := 0;
    loop
      v_ship := public.ship_date_in_week(v_base);
      -- 그 주 휴배송(④) 이거나, 1회차인데 앞당김이 되면 다음 주 같은 요일로 미룬다.
      exit when v_ship is not null and not (v_i = 1 and v_ship < v_base);
      v_defer := v_defer + 7;   -- 이월분은 뒤 회차 전체에 누적(회차 겹침 방지)
      v_base  := v_base + 7;
      v_guard := v_guard + 1;
      if v_guard >= 60 then v_ship := v_base; exit; end if;
    end loop;

    k := v_i;
    ship_date := v_ship;
    return next;
  end loop;
end;
$$;

grant execute on function public.ship_date_in_week(date)  to anon, authenticated;
grant execute on function public.closure_defers_week(date) to anon, authenticated;
grant execute on function public.sub_delivery_dates(date, date, int, int) to anon, authenticated;

-- 검증
--   -- 추석 주는 통째로 휴배송(null), 다음 주로 이월
--   select d, public.ship_date_in_week(d) from unnest(array[
--     '2026-09-21','2026-09-22','2026-09-23','2026-09-24','2026-09-25']::date[]) d;   -- 전부 null
--   -- 개천절 대체(월) → 화요일로 미루기 / 한글날(금) → 목요일로 앞당김
--   select public.ship_date_in_week('2026-10-05');  -- 2026-10-06
--   select public.ship_date_in_week('2026-10-09');  -- 2026-10-08
--   -- 월요일 구독 8회차(9/14 앵커): 9/14 → 9/29 → 10/06 → 10/12 …
--   select * from public.sub_delivery_dates('2026-09-14', null, 8, 0);
