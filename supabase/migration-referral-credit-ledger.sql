-- ─────────────────────────────────────────────────────────────
-- 추천 적립금 — Phase 1: 원장 정확성(만료·회수). additive·멱등.
--   • referral_rewards: expires_at(적립+1년)·applied_order_id
--   • referrals: qualifying_order_id(친구 첫 구독 주문 — 회수 대상 식별)
--   • orders: referral_credit_krw(차감액 기록; 사용은 Phase 2)
--   • 적립 트리거 보강: expires_at·qualifying_order_id 채움
--   • 회수: void_referral_rewards_for_order() + 슬롯 해지/환불 완료 트리거(미사용분만)
--   ⚠ 보상 금액·기간은 lib 와 동기화: 쿠폰 5,000원, 만료 1년.
-- ─────────────────────────────────────────────────────────────

-- 1) 컬럼 추가(멱등).
alter table public.referral_rewards
  add column if not exists expires_at timestamptz,
  add column if not exists applied_order_id uuid references public.orders (id);
alter table public.referrals
  add column if not exists qualifying_order_id uuid references public.orders (id);
alter table public.orders
  add column if not exists referral_credit_krw int not null default 0;

-- 2) 기존 earned 행에 만료일 백필(없으면 created_at + 1년).
update public.referral_rewards
   set expires_at = created_at + interval '1 year'
 where expires_at is null;

-- 3) 적립 트리거 보강 — qualifying_order_id(추천) + expires_at(적립건) 채움.
--    ★ 기존 동작(친구 첫 구독 입금확인 시 양쪽 earned) 유지 + 위 두 값만 추가.
--    ★ 머니 플로우 보호: 예외 전부 무시(주문 확정을 막지 않음) — 기존과 동일.
create or replace function public.referral_qualify_on_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_amt int;
  v_exp timestamptz := now() + interval '1 year';
begin
  begin
    if new.order_type = '구독' and new.status = '입금확인' then
      select * into v_ref from public.referrals
        where referee_id = new.user_id and status = 'pending'
        for update skip locked;
      if found then
        v_amt := public.referral_reward_amount();
        update public.referrals
           set status = 'qualified', qualified_at = now(), qualifying_order_id = new.id
         where id = v_ref.id;
        insert into public.referral_rewards (referral_id, user_id, role, amount_krw, status, expires_at)
        values (v_ref.id, v_ref.referrer_id, 'referrer', v_amt, 'earned', v_exp),
               (v_ref.id, v_ref.referee_id,  'referee',  v_amt, 'earned', v_exp)
        on conflict (referral_id, role) do nothing;
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

-- 4) 회수 함수 — 한 주문(친구 첫 구독)이 취소/환불되면 그 추천의 미사용분만 void.
--    양쪽(referrer·referee) earned 만 void. applied(쓴 것)·void 는 건드리지 않음(방안 ㉠). 멱등.
create or replace function public.void_referral_rewards_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.referral_rewards rw
     set status = 'void'
    from public.referrals r
   where rw.referral_id = r.id
     and r.qualifying_order_id = p_order_id
     and rw.status = 'earned';
end;
$$;

-- 5) 트리거: 구독 슬롯이 '해지'로 바뀌면 그 슬롯의 원주문 기준 회수.
--    ★ cancel_subscription 본문을 건드리지 않고 슬롯 상태 변화를 잡는다(드리프트 방지).
create or replace function public.trg_referral_void_on_slot_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = '해지' and coalesce(old.status, '') <> '해지' and new.order_id is not null then
    perform public.void_referral_rewards_for_order(new.order_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_referral_void_slot on public.subscription_slots;
create trigger trg_referral_void_slot
  after update on public.subscription_slots
  for each row execute function public.trg_referral_void_on_slot_cancel();

-- 6) 트리거: 환불(order_returns)이 '완료'로 바뀌면 그 주문 기준 회수.
create or replace function public.trg_referral_void_on_return_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = '환불' and new.status = '완료' and coalesce(old.status, '') <> '완료' then
    perform public.void_referral_rewards_for_order(new.order_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_referral_void_return on public.order_returns;
create trigger trg_referral_void_return
  after update on public.order_returns
  for each row execute function public.trg_referral_void_on_return_done();

-- ───────── 수기 검증(적용 후 SQL Editor 에서) ─────────
--   -- (a) 신규 적립건에 만료일·qualifying 채워지는지: 친구 첫 구독 입금확인 후
--   --     select expires_at from referral_rewards order by created_at desc limit 2;  -- 약 1년 뒤
--   --     select qualifying_order_id from referrals order by created_at desc limit 1; -- 그 주문 id
--   -- (b) 미사용 상태에서 슬롯 해지 → 양쪽 earned 가 void 되는지:
--   --     해당 referral 의 referral_rewards.status 가 모두 'void' 인지 확인.
--   -- (c) ★이미 applied(써버린) 뒤 해지 → void 되지 않는지(분쟁 핵심):
--   --     applied 행은 그대로 'applied' 유지되어야 함.
