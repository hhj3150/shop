-- 현금영수증 자동발행(PayAction) 전환 — 2026-08-30 적용 완료
--
--  지금까지: 관리자가 페이액션 대시보드에 들어가 '현금영수증 → 발행하기'를 손으로 눌렀다.
--            우리 화면은 발행 금액(면세·공급가액·부가세)만 계산해 보여 줬다.
--  앞으로  : 주문 등록 시 거래구분·식별번호·면세금액을 함께 보내 입금이 매칭되는 순간
--            페이액션이 자동 발행하고, 결과를 매칭완료 웹훅의 cashbill 로 돌려준다.
--            그 결과를 우리 DB 에 적어 관리자 화면이 '자동발행 완료'를 보여 준다
--            → 사람이 또 누를 이유가 없어져 이중발행이 구조적으로 막힌다.
--
--  ★ 배경: 2026-07-01 이후 현금영수증 신청 51건(소득공제 45·지출증빙 6) 중 우리 화면에
--    '발행완료'로 표시된 건은 0건이었다. 대시보드에서 발행했더라도 우리 쪽 기록이 없어
--    무엇이 발행됐는지 화면만 봐서는 알 수 없는 상태였다.

-- 1) 발행 출처·영수증 ID·실패 사유 기록 칸
alter table public.orders
  add column if not exists cash_receipt_bill_id bigint,
  add column if not exists cash_receipt_source text
    check (cash_receipt_source is null or cash_receipt_source in ('payaction', 'manual')),
  add column if not exists cash_receipt_error text,
  add column if not exists cash_receipt_cancelled_at timestamptz;

comment on column public.orders.cash_receipt_bill_id is 'PayAction 현금영수증 ID(취소 API의 cashbill_id)';
comment on column public.orders.cash_receipt_source is '발행 경로: payaction=자동발행, manual=관리자 수기';
comment on column public.orders.cash_receipt_error is '자동발행 실패 메시지(issue_failed)';
comment on column public.orders.cash_receipt_cancelled_at is '현금영수증이 취소된 시각(주문취소에 딸려 취소됨)';

-- 2) 주문 등록용 페이로드 확장 — 자동발행에 필요한 값까지 한 번에 내려준다.
--    면세/과세 분리는 앱(lib/cash-receipt-tax.ts)이 단일 출처로 계산하므로,
--    여기서는 계산에 필요한 원자료(품목·주수·배송비)만 그대로 넘긴다.
--    ★ 구독 품목 수량은 '회당'이라 block_weeks 가 반드시 함께 가야 한다.
create or replace function public.payaction_order_payload(p_order_no text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected text;
  v_o        record;
  v_items    jsonb;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select id,
         (user_id is null) as is_guest,
         order_no,
         total_amount,
         depositor_name,
         ship_name,
         ship_phone,
         ship_date,
         delivery_method,
         order_type,
         is_gift,
         gifter_name,
         status,
         block_weeks,
         shipping_fee,
         cash_receipt_type,
         cash_receipt_id,
         cash_receipt_issued,
         to_char((created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
           as order_date
    into v_o
    from public.orders
   where order_no = p_order_no;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'product_id', oi.product_id,
             'unit_price', oi.unit_price,
             'qty', oi.qty
           )),
           '[]'::jsonb
         )
    into v_items
    from public.order_items oi
   where oi.order_id = v_o.id;

  return jsonb_build_object(
    'found', true,
    'order_id', v_o.id,
    'is_guest', v_o.is_guest,
    'order_no', v_o.order_no,
    'total_amount', v_o.total_amount,
    'depositor_name', v_o.depositor_name,
    'ship_name', v_o.ship_name,
    'ship_phone', v_o.ship_phone,
    'ship_date', v_o.ship_date,
    'delivery_method', v_o.delivery_method,
    'order_type', v_o.order_type,
    'is_gift', v_o.is_gift,
    'gifter_name', v_o.gifter_name,
    'status', v_o.status,
    'block_weeks', v_o.block_weeks,
    'shipping_fee', v_o.shipping_fee,
    'cash_receipt_type', v_o.cash_receipt_type,
    'cash_receipt_id', v_o.cash_receipt_id,
    'cash_receipt_issued', v_o.cash_receipt_issued,
    'items', v_items,
    'order_date', v_o.order_date
  );
end;
$function$;

-- 3) 자동발행 결과 기록(웹훅 전용). 시크릿 게이트로 호출자를 검증한다.
--    issued       → 발행완료로 표시하고 영수증 ID 를 남긴다(관리자가 또 발행하지 않도록).
--    issue_failed → 실패 사유만 남긴다. 발행완료로 표시하지 않는다(수기 발행 대상).
--    was_issued=true 로 돌아오면 '수기 발행완료 표시가 있던 주문에 자동발행'된 것이라
--    호출측(웹훅)이 이중발행 의심 경고를 로그에 남긴다.
create or replace function public.record_cash_receipt_auto(
  p_secret   text,
  p_order_no text,
  p_bill_id  bigint,
  p_status   text,
  p_error    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected text;
  v_id       uuid;
  v_prev     boolean;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select id, cash_receipt_issued into v_id, v_prev
    from public.orders where order_no = p_order_no;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if p_status = 'issued' then
    update public.orders
       set cash_receipt_issued       = true,
           cash_receipt_issued_at    = coalesce(cash_receipt_issued_at, now()),
           cash_receipt_bill_id      = p_bill_id,
           cash_receipt_source       = 'payaction',
           cash_receipt_error        = null,
           cash_receipt_cancelled_at = null
     where id = v_id;
    return jsonb_build_object('ok', true, 'status', 'issued', 'was_issued', coalesce(v_prev, false));
  end if;

  -- 주문취소에 딸려 현금영수증이 취소된 경우: 발행완료 표시를 내리고 취소 시각을 남긴다.
  --   (주문취소 API 응답의 cashbill.status = 'cancelled' | 'partially_cancelled')
  if p_status = 'cancelled' then
    update public.orders
       set cash_receipt_issued       = false,
           cash_receipt_cancelled_at = now(),
           cash_receipt_bill_id      = coalesce(p_bill_id, cash_receipt_bill_id),
           cash_receipt_source       = 'payaction',
           cash_receipt_error        = null
     where id = v_id;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;

  update public.orders
     set cash_receipt_bill_id = p_bill_id,
         cash_receipt_source  = 'payaction',
         cash_receipt_error   = p_error
   where id = v_id;
  return jsonb_build_object('ok', true, 'status', 'failed');
end;
$function$;

-- 4) 관리자가 손으로 '발행완료'를 표시하면 출처를 manual 로 남긴다.
--    자동발행(payaction)으로 이미 기록된 건은 토글해도 출처를 payaction 으로 보존한다.
create or replace function public.mark_cash_receipt_issued(p_order_id uuid, p_issued boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  update public.orders
     set cash_receipt_issued    = p_issued,
         cash_receipt_issued_at = case when p_issued then now() else null end,
         cash_receipt_source    = case
                                    when cash_receipt_source = 'payaction' then 'payaction'
                                    when p_issued then 'manual'
                                    else null
                                  end
   where id = p_order_id;
end;
$function$;
