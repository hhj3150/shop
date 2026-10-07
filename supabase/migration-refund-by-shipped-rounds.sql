-- 해지 환불도 '실제로 받은 회차'로 센다.
--
--   [무엇이 잘못됐었나]
--     cancel_subscription 의 v_delivered 는 달력이었다 — started_at 에서 오늘까지의
--     배송 예정일 수. 출고가 밀렸거나 연장 입금이 늦어 배송이 비었던 주도 '배송됨'으로
--     세었고, 그만큼이 환불에서 빠졌다. 손님이 돈을 내고 받지 못한 회차다.
--     활성 구독 57건 · 155회차가 여기 해당한다.
--
--   [무엇을 바꾸나]
--     회차가 확정된 구독은 v_delivered 를 slot_shipped_rounds() 로 센다.
--     확정 전 구독은 지금까지의 달력 계산 그대로다(동작 변화 없음).
--     블록 체인 합(v_total)으로 상한을 둔다 — 확정값 산정 기준(block_weeks+extended_weeks)과
--     블록 체인 합이 어긋난 레거시 슬롯에서 환불이 결제액을 넘지 않게 한다.
--
--   [왜 이 수정이 필요한가 — 화면과 서버가 갈라지면 안 된다]
--     마이페이지가 '몇 회 중 몇 회'를 실제 발송으로 보여주기 시작하면, 환불만 달력으로
--     남을 수 없다. 손님은 '남은 2회'를 보고 해지했는데 0회분만 입금되는 셈이다.
--     사장님 결정: 실제 발송 기준으로 간다(2026-10-07).
create or replace function public.cancel_subscription(
  p_slot_id bigint, p_reason text, p_refund_account text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_credit_arr   int[]  := array[]::int[];   -- 블록별 선차감 적립금(원)
  v_left_arr     int[]  := array[]::int[];   -- 블록별 '남은(미배송) 회차 수'
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
  v_shipped      int;                        -- 확정된 실제 발송 회차(미확정이면 null)
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
  for v_blk in
    select o.id,
           coalesce(o.block_weeks, 0) as block_weeks,
           coalesce(o.shipping_fee, 0) as shipping_fee,
           greatest(coalesce(o.referral_credit_krw, 0), 0) as credit_krw
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
      v_ship := case when v_bw > 0 then round(v_blk.shipping_fee::numeric / v_bw)::int else 0 end;
      v_last_prod := v_prod;
      v_last_ship := v_ship;
    else
      -- 레거시(빈 블록) → 직전 블록 상속
      v_prod := v_last_prod;
      v_ship := v_last_ship;
    end if;

    v_weeks_arr  := v_weeks_arr  || v_bw;
    v_prod_arr   := v_prod_arr   || v_prod;
    v_ship_arr   := v_ship_arr   || v_ship;
    -- 적립금은 상속하지 않는다 — 그 주문에 실제로 선차감된 금액이라야 한다.
    v_credit_arr := v_credit_arr || v_blk.credit_krw;
    v_left_arr   := v_left_arr   || 0;
    v_from_arr   := v_from_arr   || v_cursor;
    v_to_arr     := v_to_arr     || (v_cursor + v_bw);
    v_cursor     := v_cursor + v_bw;
  end loop;

  v_total := v_cursor - 1;  -- Σ block_weeks

  -- 받은 회차 수.
  --   ① 확정된 구독: 실제 발송 기록으로 센다. 받지 못한 회차는 환불에 들어간다.
  --      상한은 블록 체인 합 — 확정값이 그보다 클 수 있는 레거시 슬롯에서 음수 구간이
  --      생기지 않게 한다.
  --   ② 미확정: 지금까지의 달력 계산 그대로.
  v_shipped := public.slot_shipped_rounds(p_slot_id);
  if v_shipped is not null then
    v_delivered := least(greatest(v_shipped, 0), v_total);
  elsif v_started is null then
    v_delivered := 0;
  else
    -- 진행 중인 정지는 '놓친 회차 × 7일'로 환산한다.
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

  -- 환불 := 남은 회차의 소속 블록 단가 합. 동시에 블록별 남은 회차 수를 센다.
  for v_k in (v_delivered + 1)..v_total loop
    for v_i in 1..array_length(v_weeks_arr, 1) loop
      if v_k >= v_from_arr[v_i] and v_k < v_to_arr[v_i] then
        v_refund := v_refund + v_prod_arr[v_i] + v_ship_arr[v_i];
        v_left_arr[v_i] := v_left_arr[v_i] + 1;
        exit;
      end if;
    end loop;
  end loop;

  -- 적립금 되빼기 — 블록별 `적립금 × 남은회차 / 블록회차`.
  for v_i in 1..coalesce(array_length(v_weeks_arr, 1), 0) loop
    if v_weeks_arr[v_i] > 0 and v_credit_arr[v_i] > 0 and v_left_arr[v_i] > 0 then
      v_refund := v_refund
                - round(v_credit_arr[v_i]::numeric * v_left_arr[v_i] / v_weeks_arr[v_i])::int;
    end if;
  end loop;

  v_refund := greatest(0, v_refund);

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
$function$;

-- 손님 화면이 '몇 회 중 몇 회'를 서버와 똑같이 세게 하는 조회.
--   ★ 화면이 TS 로 따로 세면 서버 환불과 갈라질 수 있다 — 그러면 '남은 2회'를 보고
--     해지했는데 0회분만 입금되는 일이 생긴다. 구현을 하나로 묶어 둔다.
--   security invoker — RLS 로 본인 것만 보이고, auth.uid() 로 한 번 더 좁힌다.
create or replace function public.my_slot_shipped_rounds()
returns table (slot_id bigint, shipped int)
language sql
stable
security invoker
set search_path = public
as $$
  select s.id, public.slot_shipped_rounds(s.id)
    from public.subscription_slots s
   where s.user_id = auth.uid()
     and s.rounds_confirmed_at is not null;
$$;

revoke all     on function public.my_slot_shipped_rounds() from public;
revoke execute on function public.my_slot_shipped_rounds() from anon;
grant  execute on function public.my_slot_shipped_rounds() to authenticated;
