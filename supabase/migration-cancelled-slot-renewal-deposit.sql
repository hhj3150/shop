-- 해지된 구독에 연장 입금이 들어오는 구멍 막기 — 돈은 받고 배송은 안 나가던 경로.
--
--   [재현 경로]
--     ① 손님이 연장(재구독)을 신청한다 → 연장 주문이 '입금대기'로 생긴다.
--     ② 입금 전에 구독을 해지한다 → 슬롯은 '해지'. 그런데 cancel_subscription 은
--        슬롯만 건드리고 '입금대기' 연장 주문은 그대로 둔다.
--     ③ 그 주문번호로 입금이 들어온다 → confirm_payment 5단계가 슬롯 상태를 보지 않고
--        apply_renewal_slot_change 를 불러 '해지' 슬롯에 extended_weeks 를 더한다.
--     ④ 배송 명단은 '해지' 슬롯을 제외한다 → 물건은 안 나간다. 알림도 없다.
--     ⇒ 손님은 돈을 냈고, 목장은 그 사실을 모른다.
--
--   [확인] 운영 DB 실측(2026-09-24). 지금 이 상태인 건은 없다('입금대기' 연장 주문 0건,
--     '해지' 슬롯에 걸린 연장 주문 0건). 경로만 열려 있는 상태라 선제로 막는다.
--
--   [막는 방식] 양쪽에서 막는다.
--     · 출발점 — 해지할 때 '입금대기' 연장 주문을 같이 취소한다(PayAction 해제는 클라이언트가).
--     · 도착점 — 그래도 입금이 들어오면 슬롯이 '해지'인지 보고, 회차를 더하는 대신
--       고아입금 원장에 적재하고 관리자에게 알린다. 주문 상태는 '입금대기'로 둔다 —
--       환불이냐 되살리기냐는 사람이 정할 일이지 함수가 정할 일이 아니다.
--
--   [함께 고침] 좌석 충돌 시 결제확인 전체 롤백.
--     apply_renewal_slot_change 는 요일 이동이 막히면 예외를 던진다. confirm_payment
--     안에서 던져지면 트랜잭션 전체가 되돌아가 '입금확인'조차 기록되지 않고, 웹훅은
--     실패로 끝나 PayAction 이 같은 요청을 계속 재전송한다. 입금은 일어난 사실이므로
--     기록은 남기고, 좌석 이동 실패만 따로 관리자에게 알린다.
--
--   ⚠ 기존 고아입금 인프라를 그대로 쓴다(orphan_deposits + orphan_inserted 플래그 +
--     웹훅 라우트의 관리자 SMS). prior_status 로 사유를 구분한다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-orphan-alert-idempotent.sql(confirm_payment 현행 정의),
--         migration-refund-referral-credit.sql(cancel_subscription 현행 정의),
--         migration-renewal-modify.sql(apply_renewal_slot_change).

do $$
begin
  if to_regclass('public.orphan_deposits') is null then
    raise exception '선행 누락: orphan_deposits — migration-orphan-deposit.sql 먼저 적용';
  end if;
  if to_regprocedure('public.apply_renewal_slot_change(uuid)') is null then
    raise exception '선행 누락: apply_renewal_slot_change — migration-renewal-modify.sql 먼저 적용';
  end if;
end $$;


-- ── 1) 해지 시 '입금대기' 연장 주문도 같이 취소 (트리거) ────────────────
--   cancel_subscription 본문을 건드리지 않고 트리거로 붙인다. 이유가 둘이다.
--     · 그 함수는 다른 작업에서도 재정의되고 있어, 양쪽이 같은 본문을 복사해 두면
--       나중에 반드시 한쪽만 갱신된다.
--     · 해지 경로가 하나가 아니다 — cancel_subscription(손님), admin_cancel_order(관리자),
--       release_slots_on_order_cancel(주문취소 연쇄), 손으로 고치는 경우까지.
--       슬롯이 '해지'가 되는 모든 길을 한 자리에서 덮는다.
--   원자적이다 — 해지와 같은 트랜잭션 안에서 처리된다.
--   ※ PayAction 등록 해제는 DB에서 못 한다(외부 API). 클라이언트
--     (lib/subscriptions.cancelSubscription)가 주문번호를 미리 읽어 두었다가 처리한다.
create or replace function public.cancel_pending_renewals_on_slot_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
     set status = '취소'
   where renews_slot_id = new.id
     and status = '입금대기';
  return null;
end;
$$;

drop trigger if exists trg_cancel_pending_renewals on public.subscription_slots;
create trigger trg_cancel_pending_renewals
  after update of status on public.subscription_slots
  for each row
  when (old.status is distinct from '해지' and new.status = '해지')
  execute function public.cancel_pending_renewals_on_slot_cancel();


-- ── 2) 연장 회차 반영 — '해지' 슬롯에는 절대 더하지 않는다 ──────────────
--   관리자 경로(confirm_renewal_payment)에서 불리면 사람이 볼 수 있게 예외로 알린다.
--   웹훅 경로(confirm_payment)는 이 함수를 부르기 전에 스스로 걸러 고아입금으로 넘긴다.
create or replace function public.apply_renewal_slot_change(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot    bigint;
  v_weeks   int;
  v_day     text;
  v_cur_day text;
  v_status  text;
  v_uid     uuid;
  v_taken   int;
begin
  select renews_slot_id, block_weeks into v_slot, v_weeks
    from public.orders where id = p_order_id;
  if v_slot is null then raise exception '연장 주문이 아닙니다.'; end if;

  -- 연장주문의 발송요일(자기 order_items; 블록 단위 단일 요일)
  select delivery_day into v_day from public.order_items where order_id = p_order_id limit 1;

  -- 슬롯 잠금 + 현재 요일·상태·소유자
  select delivery_day, status, user_id into v_cur_day, v_status, v_uid
    from public.subscription_slots where id = v_slot for update;

  -- ★ 해지된 구독에는 회차를 더하지 않는다. 더해 봐야 배송 명단이 '해지'를 제외해
  --   물건은 안 나가고, 돈만 받은 상태가 된다.
  if v_status = '해지' then
    raise exception '이미 해지된 구독이라 연장을 반영할 수 없습니다. 환불 또는 재구독으로 처리해 주세요.';
  end if;

  -- 요일 변경분이면 좌석 이동(권위 재검사).
  if v_day is not null and v_day <> v_cur_day then
    -- create_subscription_order 와 동일 lock 네임스페이스(반드시 hashtext)
    perform pg_advisory_xact_lock(hashtext('slot_day:' || v_day));

    if exists (select 1 from public.subscription_slots s
                where s.user_id = v_uid
                  and s.delivery_day = v_day
                  and s.status <> '해지'
                  and s.id <> v_slot) then
      raise exception '대상 요일에 이미 구독이 있어 좌석을 이동할 수 없습니다.';
    end if;

    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = v_day;
    if v_taken >= 100 then
      raise exception '대상 요일이 마감되어 좌석을 이동할 수 없습니다.';
    end if;

    -- 부분 유니크 인덱스 subscription_slots_user_day_uniq (user_id, delivery_day) where status<>'해지'
    -- 와의 레이스(23505)를 사용자 메시지로 변환.
    begin
      update public.subscription_slots set delivery_day = v_day where id = v_slot;
    exception when unique_violation then
      raise exception '대상 요일에 이미 구독이 있어 좌석을 이동할 수 없습니다.';
    end;
  end if;

  update public.subscription_slots
     set extended_weeks = extended_weeks + v_weeks
   where id = v_slot;
end;
$$;

revoke all on function public.apply_renewal_slot_change(uuid) from public;
revoke execute on function public.apply_renewal_slot_change(uuid) from anon;


-- ── 3) 입금확인 — 해지 슬롯 연장은 고아입금, 좌석 충돌은 플래그 ─────────
create or replace function public.confirm_payment(
  p_order_no text,
  p_secret text,
  p_paid_amount integer,
  p_pay_method text DEFAULT NULL,
  p_pg_tx_id text DEFAULT NULL
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
  v_slot_status      text;
  v_target           int;
  v_start            date;
  v_first            date;
  v_day_num          jsonb := '{"mon":1,"tue":2,"wed":3,"thu":4,"fri":5}'::jsonb;
  v_orphan_inserted  int := 0;
  v_seat_error       text;
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
        'orphan_reason', '취소주문',
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

    -- ★ 해지된 구독에 들어온 연장 입금 — 회차를 더하면 돈만 받고 배송은 안 나간다.
    --   입금확인으로 바꾸지 않고 고아입금 원장에 적재해 사람이 처리하게 한다.
    --   (환불이냐 재구독이냐는 정책 판단이라 함수가 정하지 않는다.)
    select status into v_slot_status
      from public.subscription_slots
     where id = v_order.renews_slot_id
     for update;

    if v_slot_status = '해지' then
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, '해지구독연장'
        )
      on conflict (order_no, pg_tx_id) do nothing;
      get diagnostics v_orphan_inserted = row_count;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', v_order.status, 'changed', false,
        'orphan', true, 'orphan_inserted', (v_orphan_inserted > 0),
        'orphan_reason', '해지구독연장',
        'order_type', v_order.order_type,
        'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
      );
    end if;

    update public.orders
       set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
     where id = v_order.id;

    -- ★ 좌석 이동이 막혀도 결제확인 자체는 되돌리지 않는다.
    --   예외가 밖으로 나가면 트랜잭션 전체가 롤백돼 '입금확인'조차 남지 않고, 웹훅이
    --   실패로 끝나 PayAction 이 같은 요청을 무한 재전송한다. 입금은 일어난 사실이니
    --   기록은 남기고, 좌석 이동 실패만 따로 알린다.
    begin
      perform public.apply_renewal_slot_change(v_order.id);
    exception when others then
      v_seat_error := sqlerrm;
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, '연장좌석충돌'
        )
      on conflict (order_no, pg_tx_id) do nothing;
      get diagnostics v_orphan_inserted = row_count;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', '입금확인', 'changed', true,
        'orphan', true, 'orphan_inserted', (v_orphan_inserted > 0),
        'orphan_reason', '연장좌석충돌',
        'seat_error', v_seat_error,
        'order_type', v_order.order_type,
        'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
        'ship_date', v_order.ship_date
      );
    end;

    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', '입금확인', 'changed', true,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
      'ship_date', v_order.ship_date
    );
  end if;

  -- 6) 일반 주문: 상태 입금확인 + 결제 기록
  update public.orders
     set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
   where id = v_order.id;

  -- 7) 구독 주문이면 슬롯 활성화 (신청 → 활성).
  --    started_at = 선택 요일 앵커(첫 배송 요일, KST). 2회차+ cadence 기준이라 보정하지 않는다.
  --    first_ship_date = 1회차 실제 배송일(주말·공휴일 → 다음 영업일, 목장 휴무 주 → 다음 주
  --      같은 요일). 앵커와 같으면 null(보정 불필요) — 기존 컬럼 의미 그대로.
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
      select d.ship_date into v_first
        from public.sub_delivery_dates(v_start, null, 1, 0) d;
      update public.subscription_slots
         set status = '활성',
             started_at = v_start,
             first_ship_date = case when v_first <> v_start then v_first else null end
       where id = v_slot.id;
    end loop;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', '입금확인', 'changed', true,
    'order_type', v_order.order_type,
    'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
    'ship_date', v_order.ship_date
  );
end;
$$;

grant execute on function public.confirm_payment(text, text, integer, text, text)
  to anon, authenticated;


-- 검증 (읽기만)
--   -- 해지 슬롯에 걸린 '입금대기' 연장 주문 — 0 이어야 한다
--   select count(*) from public.orders o
--     join public.subscription_slots s on s.id = o.renews_slot_id
--    where o.status = '입금대기' and s.status = '해지';
--   -- 새 분기가 들어갔는가
--   select position('해지구독연장' in pg_get_functiondef(
--            'public.confirm_payment(text,text,integer,text,text)'::regprocedure)) > 0,
--          position('연장좌석충돌' in pg_get_functiondef(
--            'public.confirm_payment(text,text,integer,text,text)'::regprocedure)) > 0;
--   -- 고아입금 원장(사유별)
--   select prior_status, count(*) from public.orphan_deposits group by 1 order by 1;
