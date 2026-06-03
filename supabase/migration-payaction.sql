-- PayAction(페이액션) 무통장입금 자동확인 연동.
--
-- 흐름: 무통장입금 주문 생성(입금대기) → PayAction 주문등록 → 구매자가 농협 계좌로 입금
--       → PayAction 자동매칭 → 우리 웹훅(매칭완료) → 입금대기→입금확인 전환.
--       입금확인 문자는 PayAction 이 직접 발송한다(우리 Solapi 미사용).
--
-- 설계 요점 (보안):
--   1) service_role 미사용. 웹훅/등록 라우트는 anon 키로 아래 RPC 만 호출한다.
--   2) RPC 는 SECURITY DEFINER(RLS 우회)이므로 공유 시크릿(p_secret)이 Vault 값과
--      정확히 일치할 때만 동작한다 — PortOne 의 confirm_payment 와 동일한 시크릿을 재사용한다.
--   3) 금액은 별도 검증하지 않는다. PayAction 이 '입금자명 + 정확금액' 매칭을 보장하므로,
--      payaction_confirm 은 DB 권위값(total_amount)을 그대로 confirm_payment 에 전달한다
--      → confirm_payment 의 금액검증을 통과하고, 구독 슬롯 활성화/연장 부수효과를 재사용한다.
--   4) 멱등: x-trace-id 를 PK 로 저장해 동일 웹훅 재전송을 방어한다.
--
-- ── 적용 방법 ────────────────────────────────────────────────────────────
--   (A) 공유 시크릿은 PortOne 과 동일한 Vault confirm_payment_secret 을 재사용한다(추가 생성 불필요).
--       PayAction 키(API/Mall/Webhook)는 Netlify 환경변수에만 둔다:
--         PAYACTION_API_BASE, PAYACTION_API_KEY, PAYACTION_MALL_ID, PAYACTION_WEBHOOK_KEY
--   (B) 이 파일 전체를 Supabase SQL Editor 에서 실행한다.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 웹훅 멱등/추적 로그. trace_id(PK)로 중복 수신을 막고, 수신 이력을 남긴다.
--    RLS enable + 정책 없음 → anon/authenticated 직접 접근 차단(SECURITY DEFINER RPC 만 기록).
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.payaction_webhook_events (
  trace_id        text primary key,
  order_no        text,
  order_status    text,
  processing_date timestamptz,
  received_at     timestamptz not null default now()
);

alter table public.payaction_webhook_events enable row level security;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. 매칭완료 웹훅 처리 RPC.
--    p_order_no        : 우리 주문번호
--    p_secret          : 공유 시크릿 (Vault confirm_payment_secret 과 일치해야 함)
--    p_trace_id        : PayAction x-trace-id (멱등 키)
--    p_order_status    : 이벤트 상태 ('매칭완료'만 확정 처리)
--    p_processing_date : PayAction 처리 시각(정보성)
--  반환: confirm_payment 결과(jsonb) 또는 { changed:false, ... }
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.payaction_confirm(
  p_order_no        text,
  p_secret          text,
  p_trace_id        text,
  p_order_status    text default '매칭완료',
  p_processing_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_total    integer;
begin
  -- 1) 공유 시크릿 검증 (시크릿은 Vault 보관 → 레포에 없음)
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  -- 2) 멱등: 동일 trace_id 는 한 번만 처리. 충돌(이미 수신)이면 즉시 반환.
  insert into public.payaction_webhook_events (trace_id, order_no, order_status, processing_date)
       values (p_trace_id, p_order_no, p_order_status, p_processing_date)
  on conflict (trace_id) do nothing;
  if not found then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  -- 3) '매칭완료' 외 상태는 기록만 하고 무시(입금취소/매칭취소 등 미래 대응 여지)
  if p_order_status is distinct from '매칭완료' then
    return jsonb_build_object('changed', false, 'ignored', p_order_status);
  end if;

  -- 4) 주문 금액(권위값) 조회. 없으면 not found 로 반환(웹훅은 200 으로 종료).
  select total_amount into v_total from public.orders where order_no = p_order_no;
  if not found then
    return jsonb_build_object('changed', false, 'error', 'order_not_found');
  end if;

  -- 5) 기존 confirm_payment 재사용. PayAction 이 정확금액 매칭을 보장하므로 DB 권위값을
  --    paid_amount 로 전달 → 금액검증 통과 + 슬롯 활성화/연장 부수효과를 그대로 수행.
  --    (p_pg_tx_id 자리에 trace_id 를 남겨 추적성 확보)
  return public.confirm_payment(p_order_no, p_secret, v_total, '무통장입금', p_trace_id);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. 주문등록용 권위 필드 조회 RPC. 등록 라우트가 금액·입금자명을 DB 에서 재조회한다
--    (브라우저가 보낸 금액은 신뢰하지 않는다 — C1). order_date 는 KST ISO8601 로 포맷.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.payaction_order_payload(
  p_order_no text,
  p_secret   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_o        record;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select order_no,
         total_amount,
         depositor_name,
         ship_name,
         ship_phone,
         is_gift,
         gifter_name,
         status,
         to_char((created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
           as order_date
    into v_o
    from public.orders
   where order_no = p_order_no;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'order_no', v_o.order_no,
    'total_amount', v_o.total_amount,
    'depositor_name', v_o.depositor_name,
    'ship_name', v_o.ship_name,
    'ship_phone', v_o.ship_phone,
    'is_gift', v_o.is_gift,
    'gifter_name', v_o.gifter_name,
    'status', v_o.status,
    'order_date', v_o.order_date
  );
end;
$$;

-- 웹훅/등록 라우트는 anon 키 클라이언트로 호출한다(시크릿으로 보호되므로 anon 허용).
grant execute on function public.payaction_confirm(text, text, text, text, timestamptz) to anon, authenticated;
grant execute on function public.payaction_order_payload(text, text) to anon, authenticated;
