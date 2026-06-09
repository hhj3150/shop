-- 고아입금(Orphan Deposit) 회수 경로.
--
-- 문제: 무통장 주문이 3일 경과로 자동취소(status='취소', migration-payment-recovery.sql)된 뒤
--       구매자가 뒤늦게 입금하면, PayAction 매칭완료 웹훅 → payaction_confirm → confirm_payment 가
--       'status <> 입금대기' 멱등 분기에서 조용히 changed:false 로 끝난다.
--       → 돈은 들어왔는데 주문은 취소 상태로 남고, 아무도 모른다(발송 누락 + 환불 누락).
--
-- 해결: confirm_payment 가 '취소' 주문에 입금확인이 들어오면 orphan_deposits 에 적재하고
--       반환 jsonb 에 orphan:true 를 실어 보낸다. 웹훅 라우트가 이를 받아 관리자 SMS 로 즉시 알린다.
--       (정상 멱등 재확인 = 이미 '입금확인' 상태는 orphan 아님 — '취소'만 적재한다.)
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행: migration-portone-payment.sql, migration-renewal-modify.sql 이 이미 적용돼 있어야 한다
--         (이 파일은 confirm_payment 를 재정의하며, 그 본문이 apply_renewal_slot_change 를 호출).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 고아입금 원장. PK(order_no, pg_tx_id) 로 동일 입금 재적재를 막는다(웹훅 재전송 멱등).
--    RLS enable + 정책 없음 → 클라이언트 직접 접근 차단(SECURITY DEFINER RPC 만 기록).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.orphan_deposits (
  order_no     text not null,
  pg_tx_id     text not null default '',
  order_id     uuid,
  paid_amount  integer,
  pay_method   text,
  prior_status text,
  detected_at  timestamptz not null default now(),
  primary key (order_no, pg_tx_id)
);

alter table public.orphan_deposits enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. confirm_payment 재정의. 기존 본문을 그대로 보존하고, step4 멱등 분기만 확장한다.
--    (migration-portone-payment.sql 의 정의 + 취소-주문 고아입금 적재.)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_payment(
  p_order_no    text,
  p_secret      text,
  p_paid_amount integer,
  p_pay_method  text default null,
  p_pg_tx_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_order    record;
  v_slot     record;
  v_target   int;
  v_start    date;
  v_day_num  jsonb := '{"mon":1,"tue":2,"wed":3,"thu":4,"fri":5}'::jsonb;
begin
  -- 1) 공유 시크릿 검증 (웹훅만 통과). 시크릿은 Vault에 보관 → 레포에 없음.
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  -- 2) 주문 조회 + 행 잠금 (동시 웹훅 재시도 대비)
  select * into v_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'order_not_found'; end if;

  -- 3) 금액 재검증 (서버 권위값과 일치해야 입금확인)
  if p_paid_amount is null or p_paid_amount <> v_order.total_amount then
    raise exception 'amount_mismatch: paid=% expected=%', p_paid_amount, v_order.total_amount;
  end if;

  -- 4) 멱등: 이미 '입금대기'가 아니면 변경 없이 현재 상태 반환.
  --    단, '취소'된 주문에 입금이 들어온 경우(고아입금)는 원장에 적재하고 orphan:true 로 알린다.
  if v_order.status <> '입금대기' then
    if v_order.status = '취소' then
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, v_order.status
        )
      on conflict (order_no, pg_tx_id) do nothing;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', v_order.status, 'changed', false, 'orphan', true,
        'order_type', v_order.order_type,
        'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
      );
    end if;
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', v_order.status, 'changed', false,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
    );
  end if;

  -- 5) 연장 주문: 주문 결제기록 + 슬롯 측(좌석 이동 + extended_weeks 누적)은 공유 헬퍼에 위임.
  --    ★ apply_renewal_slot_change 가 요일 변경분 좌석 이동까지 수행한다(자동확인 경로 이중예약 방지).
  --      ⚠ 선행: migration-renewal-modify.sql(apply_renewal_slot_change 정의)을 먼저 적용할 것.
  if v_order.renews_slot_id is not null then
    update public.orders
       set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
     where id = v_order.id;
    perform public.apply_renewal_slot_change(v_order.id);
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', '입금확인', 'changed', true,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
    );
  end if;

  -- 6) 일반 주문: 상태 입금확인 + 결제 기록
  update public.orders
     set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
   where id = v_order.id;

  -- 7) 구독 주문이면 슬롯 활성화 (신청 → 활성, started_at = 첫 배송일 KST).
  --    첫 배송일: 입금확인 다음 날(KST)부터 가장 가까운 선택 요일 (lib/ship-date.firstSubscriptionDelivery 와 동일 규칙).
  if v_order.order_type = '구독' then
    for v_slot in
      select id, delivery_day from public.subscription_slots
       where order_id = v_order.id and status = '신청'
    loop
      v_target := (v_day_num ->> v_slot.delivery_day)::int;
      v_start  := (now() at time zone 'Asia/Seoul')::date + 1;
      while extract(dow from v_start)::int <> v_target loop
        v_start := v_start + 1;
      end loop;
      update public.subscription_slots
         set status = '활성', started_at = v_start
       where id = v_slot.id;
    end loop;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', '입금확인', 'changed', true,
    'order_type', v_order.order_type,
    'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
  );
end;
$$;

-- 웹훅은 anon 키 클라이언트로 호출한다(서명·시크릿으로 보호되므로 anon 허용).
grant execute on function public.confirm_payment(text, text, integer, text, text) to anon, authenticated;
