-- PayAction 웹훅 원본 바디 보존 (관찰 안전장치).
--
-- 배경: payaction_confirm 은 PayAction 이 '입금자명+정확금액' 매칭을 보장한다는 전제로
--   DB 권위값(total_amount)을 그대로 confirm_payment 에 전달한다 → 금액검증이 자기 자신과
--   비교라 항상 통과한다. 그런데 웹훅 페이로드에 실제 '입금액' 필드가 있는지 레포가 확정하지
--   못한다(설계 스펙엔 order_number/order_status/processing_date 만 명시).
--
-- 목적: 입금확인 결정 로직은 전혀 바꾸지 않고(순수 기록), 웹훅 원본 바디를 그대로 적재한다.
--   며칠 실트래픽을 관찰해 PayAction 이 금액 필드를 보내는지 '증거'로 확정한다.
--     - 금액이 온다 → 그 값을 confirm_payment 의 p_paid_amount 로 실어 진짜 금액검증 활성화(후속).
--     - 안 온다   → PayAction API 협의가 필요한 진짜 블로커로 확정.
--
-- ⚠ 결정 로직 불변: 시크릿 검증·멱등·'매칭완료' 게이트·confirm_payment 호출 모두 기존과 동일.
--   유일한 변경은 (a) raw_body 컬럼 추가, (b) 멱등 insert 에 raw_body 만 추가 기록, (c) 시그니처에
--   p_raw_body 인자 추가.
--
-- ── 배포 순서(중요) ─────────────────────────────────────────────────────────
--   이 SQL 을 prod 에 '먼저' 적용한 뒤 코드(웹훅)를 머지한다.
--   적용 후엔 기존 5인자 호출도 새 함수의 기본값(p_raw_body=null)으로 해석되어 그대로 동작하므로
--   (구 코드/신 코드 모두 호환), 코드 머지 전에 적용해도 안전하다.
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 1회 실행.

begin;

-- 1) 원본 바디 컬럼(추가만 — 기존 행은 null, 영향 없음).
alter table public.payaction_webhook_events
  add column if not exists raw_body jsonb;

-- 2) payaction_confirm 재정의: p_raw_body 인자 추가 + 멱등 insert 에 raw_body 기록.
--    기존 5인자 정의는 먼저 제거한다(5인자 named 호출이 새 6인자 함수의 기본값으로 유일하게
--    해석되도록 — 두 정의가 공존하면 호출 모호성 오류).
drop function if exists public.payaction_confirm(text, text, text, text, timestamptz);

create or replace function public.payaction_confirm(
  p_order_no        text,
  p_secret          text,
  p_trace_id        text,
  p_order_status    text default '매칭완료',
  p_processing_date timestamptz default null,
  p_raw_body        jsonb default null
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
  -- 1) 공유 시크릿 검증 (Vault confirm_payment_secret 과 일치해야 함)
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  -- 2) 멱등: 동일 trace_id 는 한 번만 처리. 관찰용 원본 바디(raw_body)를 함께 적재한다.
  --    (raw_body 외 컬럼·동작은 기존과 동일. 재전송 시 do nothing → 최초 1건만 기록.)
  insert into public.payaction_webhook_events (trace_id, order_no, order_status, processing_date, raw_body)
       values (p_trace_id, p_order_no, p_order_status, p_processing_date, p_raw_body)
  on conflict (trace_id) do nothing;
  if not found then
    return jsonb_build_object('changed', false, 'idempotent', true);
  end if;

  -- 3) '매칭완료' 외 상태는 기록만 하고 무시
  if p_order_status is distinct from '매칭완료' then
    return jsonb_build_object('changed', false, 'ignored', p_order_status);
  end if;

  -- 4) 주문 금액(권위값) 조회
  select total_amount into v_total from public.orders where order_no = p_order_no;
  if not found then
    return jsonb_build_object('changed', false, 'error', 'order_not_found');
  end if;

  -- 5) 기존 confirm_payment 재사용 (결정 로직 불변)
  return public.confirm_payment(p_order_no, p_secret, v_total, '무통장입금', p_trace_id);
end;
$$;

grant execute on function public.payaction_confirm(text, text, text, text, timestamptz, jsonb) to anon, authenticated;

commit;

-- ── 관찰 쿼리 (적용 후 수일 뒤 실행) ────────────────────────────────────────
--   PayAction 이 보낸 원본에 '입금액'으로 볼 수 있는 키가 있는지 확인:
--   select trace_id, order_no, received_at, raw_body
--     from public.payaction_webhook_events
--    where received_at > now() - interval '14 days'
--    order by received_at desc;
--   → raw_body 에 amount / paid_amount / deposit_amount / 입금액 / price 등이 있으면
--     그 값을 confirm_payment(p_paid_amount)로 실어 진짜 금액검증을 켜는 후속 작업으로 이어간다.
