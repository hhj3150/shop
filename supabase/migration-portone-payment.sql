-- PortOne(포트원) v2 결제 도입: 웹훅이 입금/결제 완료를 자동 확인하는 경로.
--
-- 설계 요점 (보안):
--   1) service_role 미사용. 웹훅(Next.js 서버 라우트)은 anon 키로 이 RPC만 호출한다.
--   2) 이 RPC는 SECURITY DEFINER 라 RLS를 우회해 모든 주문을 갱신할 수 있으므로,
--      공유 시크릿(p_secret)이 Vault에 저장된 값과 정확히 일치할 때만 동작한다.
--      → 시크릿을 모르는 외부인은 호출해도 즉시 거절된다.
--   3) 금액은 항상 서버 권위값(orders.total_amount)과 대조한다. 위조된 결제금액으로는
--      입금확인이 일어나지 않는다(과소결제 방지).
--   4) 멱등: 이미 '입금대기'가 아니면(이미 확인/취소 등) 아무 것도 바꾸지 않는다.
--
-- ── 적용 방법 (Supabase SQL Editor에서 순서대로) ──────────────────────────
--   (A) Vault에 공유 시크릿 저장 (값은 무작위 문자열; 절대 레포/깃에 넣지 말 것):
--         select vault.create_secret('<무작위-긴-문자열>', 'confirm_payment_secret');
--       이미 있으면 갱신:
--         select vault.update_secret(
--           (select id from vault.secrets where name = 'confirm_payment_secret'),
--           '<무작위-긴-문자열>');
--       → 같은 값을 Netlify 환경변수 CONFIRM_PAYMENT_SECRET 에도 넣는다.
--   (B) 이 파일 전체를 실행한다.

-- 결제 기록용 컬럼 (정보성). 입금확인 시각·수단·PG 거래번호를 남긴다.
alter table public.orders
  add column if not exists paid_at    timestamptz,
  add column if not exists pay_method text,
  add column if not exists pg_tx_id   text;

-- 웹훅에서 호출하는 입금확인 RPC.
--   p_order_no    : 주문번호(= PortOne paymentId)
--   p_secret      : 공유 시크릿 (Vault의 confirm_payment_secret 과 일치해야 함)
--   p_paid_amount : PG가 실제 승인한 총 결제금액 (서버 권위 total_amount 와 일치해야 함)
--   p_pay_method  : 결제수단 (VIRTUAL_ACCOUNT/CARD/EASY_PAY 등, 정보성)
--   p_pg_tx_id    : PortOne 거래번호 (정보성)
-- 반환: { order_id, order_no, status, changed, order_type, ship_name, ship_phone }
--   changed=true 이고 status='입금확인' 일 때만 웹훅이 입금확인 문자를 보낸다.
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

  -- 4) 멱등: 이미 '입금대기'가 아니면 변경 없이 현재 상태 반환
  if v_order.status <> '입금대기' then
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
