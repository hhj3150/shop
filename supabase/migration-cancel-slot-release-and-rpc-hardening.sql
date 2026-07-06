-- 주문 취소 시 미시작 슬롯 자동 자리반환 + RPC 실행권한 강화(전수 점검 후속).
--
-- 문제 1 (prod 데이터로 확정 — 좀비 슬롯):
--   관리자 화면의 주문 '취소'는 orders.status 만 바꾸고, 그 주문이 점유한 미시작
--   슬롯(신청/대기)을 해지하지 않는다. 회원 자가취소(cancel_unpaid_order)는 자리를
--   반환하므로 경로 간 불일치. 실사례: slot 35(목, 신청)가 6/9 취소 주문에 묶여
--   한 달째 목요일 정원 1자리를 점유했고(공개 잔여석 카운트 왜곡), 해당 회원이
--   목요일로 재신청하면 '이미 진행 중인 구독' 안내로 부당 차단된다.
--   → orders.status → '취소' 전이 시 미시작 슬롯을 자동 해지하는 트리거로
--     모든 취소 경로(관리자 UI·RPC·수동 SQL)를 한 번에 커버한다.
--   · 활성 슬롯은 건드리지 않는다 — 입금확인된 구독의 해지는 환불 동반이라
--     별도 흐름(cancel_subscription)이 맞다(관리자 확인창 문구 그대로).
--   · 연장 주문 취소는 원 구독 슬롯과 무관하다(slots.order_id 는 원 주문만 가리킴).
--
-- 문제 2 (Supabase security advisor + 전수 점검으로 확정 — 내부 헬퍼 노출):
--   내부 전용 SECURITY DEFINER 헬퍼가 PostgREST 로 anon/authenticated 에게
--   직접 호출 가능했다(기본 PUBLIC EXECUTE). 악용 시나리오:
--   · _create_once_order_core(p_uid, …): 임의 사용자 명의로 주문 생성
--   · apply_referral_credit(p_user, …): 타인 적립금 무단 소진
--   · void_referral_rewards_for_order / apply_renewal_slot_change: 상태 무단 변경
--   · _rebuild_subscription_slots: 임의 주문의 슬롯 정보 노출
--   → 다섯 함수의 EXECUTE 를 회수한다. SECURITY DEFINER 부모 RPC 내부 호출은
--     함수 소유자 권한으로 실행되므로 영향 없다(코드 전수 grep — 클라이언트
--     직접 호출 0건 확인).
--
-- 문제 3 (advisor: function_search_path_mutable):
--   search_path 미고정 함수 5개를 public 으로 고정한다(하이재킹 방지, 동작 동일).
--
-- 데이터 보수: slot 35(취소 주문 SY20260609-7437 의 신청 슬롯)를 해지 처리해
--   목요일 자리를 반환한다(트리거 도입 전 발생분의 소급 정리 — 동일 상태의
--   다른 슬롯도 함께 정리되도록 조건부 UPDATE 로 작성).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행(단일 트랜잭션).

begin;

-- ── 1) 취소 전이 트리거: 미시작 슬롯 자리반환 ──────────────────────────
create or replace function public.release_slots_on_order_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 미시작(신청/대기) 슬롯만 해지 — 활성은 환불 동반 해지 흐름(cancel_subscription) 대상.
  update public.subscription_slots
     set status        = '해지',
         cancel_reason = coalesce(cancel_reason, '주문 취소(자리 반환)'),
         cancelled_at  = coalesce(cancelled_at, (now() at time zone 'Asia/Seoul')::date)
   where order_id = new.id
     and status in ('신청','대기');
  return new;
end;
$$;

drop trigger if exists trg_release_slots_on_order_cancel on public.orders;
create trigger trg_release_slots_on_order_cancel
  after update of status on public.orders
  for each row
  when (new.status = '취소' and old.status is distinct from '취소')
  execute function public.release_slots_on_order_cancel();

-- ── 2) 소급 보수: 이미 취소된 주문에 묶인 미시작 슬롯 해지(현재 1건: slot 35) ──
update public.subscription_slots s
   set status        = '해지',
       cancel_reason = coalesce(s.cancel_reason, '주문 취소(자리 반환, 소급)'),
       cancelled_at  = coalesce(s.cancelled_at, (now() at time zone 'Asia/Seoul')::date)
 where s.status in ('신청','대기')
   and exists (select 1 from public.orders o where o.id = s.order_id and o.status = '취소');

-- ── 3) 내부 헬퍼 실행권한 회수(외부 직접 호출 차단) ────────────────────
revoke execute on function public._create_once_order_core(uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public._rebuild_subscription_slots(uuid) from public, anon, authenticated;
revoke execute on function public.apply_referral_credit(uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function public.apply_renewal_slot_change(uuid) from public, anon, authenticated;
revoke execute on function public.void_referral_rewards_for_order(uuid) from public, anon, authenticated;

-- ── 4) search_path 고정(advisor: function_search_path_mutable) ─────────
alter function public.period_discount(integer) set search_path = public;
alter function public.gen_order_no() set search_path = public;
alter function public.is_special_delivery_postcode(text) set search_path = public;
alter function public.referral_reward_amount() set search_path = public;
alter function public._rg_expiry_check() set search_path = public;

-- ── 5) 1회성 알림 중복발송 판정 RPC(시크릿 게이트) ──────────────────────
--   /api/notify 의 비관리자 알림(order_received·gift_*·renewal_guide·welcome)은
--   서버측 멱등이 없어, 같은 orderId 로 반복 POST 하면 임의 지정 가능한 수신번호로
--   문자를 무제한 발송할 수 있었다(스팸 중계·비용 남용). 라우트가 발송 전 이 RPC 로
--   sms_log 의 성공 기록을 확인해 재발송을 거른다(실패 기록은 재시도 허용).
--   시크릿은 기존 Vault confirm_payment_secret 재사용(append_sms_log 와 동일 패턴).
create or replace function public.sms_already_sent(
  p_secret   text,
  p_kind     text,
  p_order_id uuid default null,
  p_user_id  uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_order_id is not null then
    return exists (
      select 1 from public.sms_log
       where kind = p_kind and order_id = p_order_id and ok
    );
  elsif p_user_id is not null then
    return exists (
      select 1 from public.sms_log
       where kind = p_kind and user_id = p_user_id and ok
    );
  end if;
  return false;
end;
$$;

revoke execute on function public.sms_already_sent(text, text, uuid, uuid) from public;
grant execute on function public.sms_already_sent(text, text, uuid, uuid) to anon, authenticated;

-- ── 6) ship-reminder 크론 RPC grant 정리 ────────────────────────────────
--   다른 시크릿게이트 크론 RPC 는 'revoke from public + grant anon' 패턴인데 이 둘만
--   기본 PUBLIC EXECUTE 에 기대고 있었다(향후 일괄 revoke 시 크론이 조용히 깨지는 구성).
--   같은 패턴으로 명시한다(동작 변화 없음 — 시크릿 게이트는 함수 내부).
revoke execute on function public.ship_reminder_dataset(text, date) from public;
revoke execute on function public.record_ship_reminder(text, uuid, date) from public;
grant execute on function public.ship_reminder_dataset(text, date) to anon, authenticated;
grant execute on function public.record_ship_reminder(text, uuid, date) to anon, authenticated;

commit;

-- ── 검증(수동, SQL Editor) ──────────────────────────────────────
-- A. 소급 보수 확인: 취소 주문에 묶인 신청/대기 슬롯이 0이어야 한다.
--   select count(*) from subscription_slots s join orders o on o.id=s.order_id
--    where s.status in ('신청','대기') and o.status='취소';   -- 0
--
-- B. 트리거 확인(트랜잭션 안에서 실험 후 롤백):
--   begin;
--     update orders set status='취소' where id='<입금대기 구독주문 id>';
--     select status from subscription_slots where order_id='<같은 id>';  -- 해지
--   rollback;
--
-- C. 권한 회수 확인: anon 으로 내부 헬퍼 호출 시 permission denied.
--   set role anon;
--   select public.apply_referral_credit('00000000-0000-0000-0000-000000000000', 1000, gen_random_uuid());
--   -- ERROR: permission denied for function
--   reset role;
