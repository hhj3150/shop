-- 해지 환불에 추천 적립금 반영 — 남은 회차분만큼 되뺀다(회차별 안분).
--
--   [문제] 주문 생성 시 orders.total_amount 는 이미 적립금을 뺀 '실결제액'인데,
--     해지 환불은 정가 구성(order_items.unit_price)으로 계산한다. 그래서 적립금을
--     되빼지 않으면 손님이 낸 적 없는 돈이 나간다.
--
--       회당 1만원 × 12회 = 120,000원 / 쿠폰 12,000원 → 실결제 108,000원
--         · 첫 배송 전 해지 : 옛 계산 120,000원 환불 → 12,000원 과다 지급
--         · 6회 받고 해지   : 옛 계산  60,000원 환불 →  6,000원 과다 지급
--                             (공평한 값 = 실결제 108,000 × 6/12 = 54,000원)
--
--   [정책] 회차별 안분. 구독의 상품비·배송비가 이미 회차별로 안분돼 있으므로 적립금도
--     같은 규칙을 쓴다 — 블록별로 `적립금 × 남은회차 / 블록회차` 를 뺀다.
--     전 회차가 남으면 적립금 전액이 빠져 환불액이 정확히 실결제액이 된다.
--     ※ 적립금은 주문 단위다(orders.referral_credit_krw). 연장주문이 자기 적립금을
--       가질 수 있으므로 블록마다 자기 주문의 값으로 안분한다.
--
--   ⚠ lib/subscription-timeline.ts(refundForRoundsFrom) 와 반드시 같은 규칙을 유지한다.
--     갈리면 손님 화면의 '환불 미리보기'와 실제 지급액이 달라진다.
--
--   운영 현황(2026-09-24): referral_credit_krw > 0 인 주문 0건 — 실손실 없이 선제 수정.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-pause-missed-rounds.sql(cancel_subscription 현행 정의),
--         migration-referral-credit-ledger.sql(orders.referral_credit_krw).

do $$
begin
  if to_regprocedure('public.missed_delivery_weeks(date,date,int,int,date,date)') is null then
    raise exception '선행 누락: missed_delivery_weeks — migration-pause-missed-rounds.sql 먼저 적용';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders'
       and column_name = 'referral_credit_krw'
  ) then
    raise exception '선행 누락: orders.referral_credit_krw — migration-referral-credit-ledger.sql 먼저 적용';
  end if;
end $$;


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
      -- 자기 items 보유 블록 (v_prod 는 위 select 에서 채워짐)
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
    -- 적립금은 상속하지 않는다 — 단가는 레거시 빈 블록이 직전 블록에서 물려받지만,
    --   적립금은 '그 주문에 실제로 선차감된 금액'이라 블록 자신의 값을 쓴다.
    v_credit_arr := v_credit_arr || v_blk.credit_krw;
    v_left_arr   := v_left_arr   || 0;
    v_from_arr   := v_from_arr   || v_cursor;
    v_to_arr     := v_to_arr     || (v_cursor + v_bw);
    v_cursor     := v_cursor + v_bw;
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
  --   동시에 블록별 남은 회차 수를 세어 둔다(적립금 안분에 쓴다).
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
  --   전 회차가 남으면 적립금 전액이 빠져 환불액이 정확히 실결제액이 된다.
  for v_i in 1..coalesce(array_length(v_weeks_arr, 1), 0) loop
    if v_weeks_arr[v_i] > 0 and v_credit_arr[v_i] > 0 and v_left_arr[v_i] > 0 then
      v_refund := v_refund
                - round(v_credit_arr[v_i]::numeric * v_left_arr[v_i] / v_weeks_arr[v_i])::int;
    end if;
  end loop;

  -- 적립금이 상품비를 넘는 구성에서도 음수 환불은 나올 수 없다.
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
$$;

grant execute on function public.cancel_subscription(bigint, text, text) to authenticated;


-- 검증 (운영 DB에서 읽기만 — 쓰지 않는다)
--   -- 적립금을 쓴 주문이 있는지
--   select count(*) from public.orders where coalesce(referral_credit_krw,0) > 0;   -- 2026-09-24: 0
--   -- 적립금 반영 여부(본문에 referral_credit_krw 가 들어갔는가)
--   select position('referral_credit_krw' in
--            pg_get_functiondef('public.cancel_subscription(bigint,text,text)'::regprocedure)) > 0;  -- true
