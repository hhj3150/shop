-- 정기구독 배송요일 변경 — 회원 본인·관리자 공용 RPC.
--
--   배경:
--     요일 변경은 지금까지 '연장(재구독) 신청' 때만 가능했다(request_renewal → apply_renewal_slot_change).
--     진행 중인 구독의 요일은 손님도 관리자도 바꿀 수 없었다. 사정이 생겨 요일을 옮기려면
--     해지 후 재가입뿐이었다.
--
--   왜 앵커(started_at)까지 옮기는가:
--     이 시스템은 구독을 두 축으로 본다.
--       · 회차 계산(sub_delivery_dates / computeSchedule): 앵커 + (k-1)주 → 기발송 회차·종료일·환불액
--       · 실제 발송일(buildRosterForDate): order_items.delivery_day 요일에 맞는 날짜
--     둘은 '앵커도 그 요일'이라는 전제로만 맞물린다. 요일만 바꾸면 최대 나흘이 어긋나
--     마지막 회차가 종료일을 넘겨 사라지거나 첫 회차가 시작 전으로 밀린다(회차 소실).
--
--   불변식(이 함수가 서버에서 강제):
--     총 회차와 '이미 나간 회차 수'가 변경 전후로 같아야 한다. 하나라도 어긋나면 손님이
--     한 주를 더 받거나(이중 발송) 한 주를 잃는다. 앵커 후보는 클라이언트가 계산해 보내지만,
--     믿지 않고 여기서 다시 검증한다(요일 일치·회차 보존).
--
--   좌석 규율은 연장 경로(apply_renewal_slot_change)와 동일하게 지킨다:
--     같은 lock 네임스페이스(hashtext('slot_day:'||day)) · 1인 1요일 · 요일당 100석.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.

create or replace function public.change_delivery_day(
  p_slot_id        bigint,
  p_new_day        text,
  p_new_started_at date default null
)
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

  -- 본인 또는 관리자만.
  if not v_admin and v_slot.user_id is distinct from v_uid then
    raise exception '본인 구독만 변경할 수 있습니다.';
  end if;
  if v_slot.status <> '활성' then
    raise exception '활성 구독만 요일을 바꿀 수 있습니다.';
  end if;
  if p_new_day = v_slot.delivery_day then
    raise exception '이미 그 요일로 받고 계십니다.';
  end if;

  v_total := greatest(v_slot.block_weeks + coalesce(v_slot.extended_weeks, 0), 1);

  -- ── 좌석 규율 (연장 경로와 동일) ──
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

  -- ── 앵커 검증: 새 요일에 떨어지고, 회차가 보존되어야 한다 ──
  if v_slot.started_at is null then
    -- 아직 첫 배송 전(입금확인 대기 등) — 요일만 바꾼다. 앵커는 입금확인 때 새 요일로 부여된다.
    p_new_started_at := null;
  else
    if p_new_started_at is null then
      raise exception '새 시작 기준일이 필요합니다.';
    end if;
    -- 1=월 … 5=금 (v_daynum). 새 앵커가 그 요일에 떨어져야 로스터와 회차 계산이 맞물린다.
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

  -- ── 반영 ──
  --   1) 좌석(요일) 이동 + 앵커 교체. first_ship_date 는 옛 앵커의 1회차 공휴일 보정이라 버린다.
  --      1인 1요일(부분 유니크 인덱스)은 위 advisory lock 아래 사전 검사로 막는다.
  update public.subscription_slots
     set delivery_day    = p_new_day,
         started_at      = coalesce(p_new_started_at, started_at),
         first_ship_date = null
   where id = p_slot_id;

  --   2) 발송 명단은 order_items.delivery_day 로 그날 배송분을 고른다 → 이 슬롯의 모든 블록
  --      (원주문 + 연장주문)의 품목 요일을 함께 옮긴다. 앵커가 전 회차를 통째로 이동시키므로
  --      블록도 같은 요일로 맞춰야 과거·미래 명단이 앵커와 어긋나지 않는다.
  update public.order_items i
     set delivery_day = p_new_day
    from public.orders o
   where o.id = i.order_id
     and (o.id = v_slot.order_id or o.renews_slot_id = p_slot_id)
     and i.delivery_day is not null;

  -- 안내용 반환값(다음 배송일 · 종료 예정일).
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

revoke all on function public.change_delivery_day(bigint, text, date) from public;
revoke execute on function public.change_delivery_day(bigint, text, date) from anon;
grant execute on function public.change_delivery_day(bigint, text, date) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 관리자 대행 일시정지·재개
--   pause_subscription / resume_subscription 은 auth.uid() 로 본인 슬롯만 다룬다.
--   전화로 "다음 달까지 쉬어 주세요" 하는 손님을 관리자가 대신 처리할 수 있게 관리자용을 둔다.
--   정지·재개 수학(paused_at 기록 → 재개 시 paused_days 누적)은 기존과 동일하다 —
--   총 회차는 보존되고 종료일만 정지한 일수만큼 밀린다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_set_subscription_paused(
  p_slot_id bigint,
  p_paused  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot  record;
  -- 정지일수 누적 기준일은 기존 pause/resume_subscription 과 같은 current_date 를 쓴다
  --   (관리자 대행분만 하루 어긋나 종료일이 갈리지 않도록).
  v_today date := current_date;
  v_add   int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_slot from public.subscription_slots where id = p_slot_id for update;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;
  if v_slot.status <> '활성' then raise exception '활성 구독만 정지·재개할 수 있습니다.'; end if;

  if p_paused then
    if v_slot.paused then return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', false); end if;
    update public.subscription_slots
       set paused = true, paused_at = v_today, skip_resume_on = null
     where id = p_slot_id;
    return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', true);
  end if;

  if not v_slot.paused then return jsonb_build_object('slot_id', p_slot_id, 'paused', false, 'changed', false); end if;
  -- 정지한 일수를 누적하고 재개 — 종료일이 그만큼 뒤로 밀린다(회차는 보존).
  v_add := greatest(0, v_today - coalesce(v_slot.paused_at, v_today));
  update public.subscription_slots
     set paused = false,
         paused_at = null,
         paused_days = coalesce(paused_days, 0) + v_add,
         skip_resume_on = null
   where id = p_slot_id;
  return jsonb_build_object('slot_id', p_slot_id, 'paused', false, 'changed', true, 'added_days', v_add);
end;
$$;

revoke all on function public.admin_set_subscription_paused(bigint, boolean) from public;
revoke execute on function public.admin_set_subscription_paused(bigint, boolean) from anon;
grant execute on function public.admin_set_subscription_paused(bigint, boolean) to authenticated;

-- 검증
--   select * from public.change_delivery_day(<slot>, 'wed', '<새 앵커>');
--   → 반환 next_date 가 수요일이고, 그 슬롯의 order_items.delivery_day 가 모두 'wed' 여야 한다.
--   select public.admin_set_subscription_paused(<slot>, true);  -- 정지
--   select public.admin_set_subscription_paused(<slot>, false); -- 재개(정지일수 누적)
