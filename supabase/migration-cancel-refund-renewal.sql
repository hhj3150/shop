-- ─────────────────────────────────────────────────────────────
-- 구독 해지 환불 — 연장(재구독) 분 포함 수정
--
--   결함(수정 전): cancel_subscription 의 환불 계산이 슬롯의 원주문(order_id)만 보았다.
--     · 총회차 = 원주문.block_weeks (연장 누적분 extended_weeks 누락)
--     · 총납입액 = 원주문.total_amount (별도 연장주문 금액 누락)
--   → 연장한 구독을 해지하면 연장분으로 낸 돈과 늘어난 회차가 통째로 빠져,
--     고객이 연장금액을 한 푼도 돌려받지 못했다.
--
--   수정: 환불을 '총 납입액·총 회차 전체' 기준으로 재정의(서버 권위 계산 C2 유지).
--     · 총회차    = 원주문.block_weeks + 슬롯.extended_weeks
--     · 총납입액  = 원주문.total_amount + Σ(연장주문.total_amount where 입금확인)
--       (extended_weeks 는 confirm_renewal_payment 에서 연장주문 입금확인 시에만 누적되므로,
--        연장주문도 status='입금확인' 만 합산해야 회차·금액이 정확히 대응한다.
--        미입금(입금대기) 연장은 회차에도 금액에도 반영하지 않는다.)
--     · 남은회차  = 총회차 − 배송완료회차 (정지일수 반영 — 기존 규칙 그대로)
--     · 환불      = round(총납입액 / 총회차) × 남은회차
--       배송비는 회당 단가에 포함되어 미배송분만큼 비례 환불된다(정책: 배송비 포함).
--
--   외과적 수정: 환불 산식의 '총회차·총납입액' 두 표현식만 교체. 나머지 100% 보존.
--   본문 출처(라이브 최신): schema.sql 의 cancel_subscription.
--
-- 멱등: create or replace. 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.cancel_subscription(bigint, text, text);

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
  v_total_weeks  int;
  v_total_amount int;
  v_started      date;
  v_paused       boolean;
  v_paused_at    date;
  v_paused_days  int;
  v_today        date := (now() at time zone 'Asia/Seoul')::date;
  v_elapsed      int;
  v_delivered    int;
  v_remaining    int;
  v_refund       int;
begin
  -- 총회차·총납입액은 원주문 + '입금확인' 연장주문 전체를 합산한다.
  select s.started_at, s.paused, s.paused_at, s.paused_days,
         coalesce(o.block_weeks, 0) + coalesce(s.extended_weeks, 0),
         coalesce(o.total_amount, 0)
           + coalesce((select sum(r.total_amount)::int
                         from public.orders r
                        where r.renews_slot_id = s.id
                          and r.status = '입금확인'), 0)
    into v_started, v_paused, v_paused_at, v_paused_days, v_total_weeks, v_total_amount
    from public.subscription_slots s
    left join public.orders o on o.id = s.order_id
   where s.id = p_slot_id
     and s.user_id = auth.uid()
     and s.status in ('활성','대기')
   for update of s;
  if not found then
    raise exception '해지할 수 있는 구독이 아닙니다.';
  end if;

  if v_started is null then
    v_remaining := v_total_weeks;
  else
    v_elapsed := (v_today - v_started)
      - (v_paused_days
         + case when v_paused and v_paused_at is not null
                then greatest(0, v_today - v_paused_at) else 0 end);
    if v_elapsed < 0 then
      v_delivered := 0;
    else
      v_delivered := least(v_total_weeks, (v_elapsed / 7) + 1);
    end if;
    v_remaining := greatest(0, v_total_weeks - v_delivered);
  end if;

  if v_total_weeks > 0 then
    v_refund := (round(v_total_amount::numeric / v_total_weeks) * v_remaining)::int;
  else
    v_refund := 0;
  end if;

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

-- ───────── 사장님 적용 절차 ─────────
-- 1) 위 함수를 Supabase SQL Editor 에서 실행(create or replace, 멱등).
-- 2) 검증: 연장(입금확인)한 활성 구독을 해지하면 환불액에 연장분이 포함되는지 확인.
--    예) 4주 4만원 + 4주 연장 4만원(=8회/8만원), 2회 배송 후 해지 → 남은 6회 → 환불 60,000원.
