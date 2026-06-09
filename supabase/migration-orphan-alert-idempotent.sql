-- 고아입금 알림 멱등화: confirm_payment 가 orphan_deposits 에 '새로 적재됐을 때만' 알리도록 플래그 추가.
--
-- 문제: confirm_payment 의 orphan 분기는 적재(on conflict do nothing)는 멱등이지만, 반환은 항상
--   orphan:true 라, 웹훅 라우트가 그 플래그만 보고 매번 관리자 SMS 를 보낸다. PortOne 웹훅이
--   재전송되면(동일 취소 주문) 적재는 1건인데 SMS 는 재시도 횟수만큼 중복 발송된다.
--
-- 해결: 적재 직후 ROW_COUNT 로 '이번에 처음 적재됐는지'를 판별해 orphan_inserted 로 반환한다.
--   웹훅 라우트는 orphan_inserted=true 일 때만 알린다(적재와 알림 멱등 기준 일치).
--   (migration-orphan-deposit.sql 의 confirm_payment 정의 + orphan 분기만 보강.)
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행: migration-orphan-deposit.sql, migration-portone-payment.sql, migration-renewal-modify.sql.

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
  v_expected         text;
  v_order            record;
  v_slot             record;
  v_target           int;
  v_start            date;
  v_day_num          jsonb := '{"mon":1,"tue":2,"wed":3,"thu":4,"fri":5}'::jsonb;
  v_orphan_inserted  int := 0;
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
  --    단, '취소'된 주문에 입금이 들어온 경우(고아입금)는 원장에 적재하고, '이번에 처음 적재됐을 때만'
  --    orphan_inserted=true 로 알린다(웹훅 재전송 중복 알림 방지).
  if v_order.status <> '입금대기' then
    if v_order.status = '취소' then
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, v_order.status
        )
      on conflict (order_no, pg_tx_id) do nothing;
      get diagnostics v_orphan_inserted = row_count;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', v_order.status, 'changed', false,
        'orphan', true, 'orphan_inserted', (v_orphan_inserted > 0),
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

grant execute on function public.confirm_payment(text, text, integer, text, text) to anon, authenticated;
