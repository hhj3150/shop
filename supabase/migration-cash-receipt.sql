-- ─────────────────────────────────────────────────────────────
-- 현금영수증 (무통장입금 수기 발행)
--   결제가 무통장입금이라 PG 자동발행이 없으므로, 주문 시 고객이 발행 방식과
--   식별번호를 고르면 관리자가 홈택스에서 직접 발행한다. 이 마이그레이션은
--   (1) orders 에 발행정보 컬럼 추가, (2) 고객용 set_cash_receipt RPC,
--   (3) 관리자용 mark_cash_receipt_issued RPC 를 만든다.
-- 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

alter table public.orders
  add column if not exists cash_receipt_type text not null default '발행안함'
    check (cash_receipt_type in ('소득공제','지출증빙','발행안함')),
  add column if not exists cash_receipt_id text,           -- 소득공제: 휴대폰, 지출증빙: 사업자등록번호 (숫자만)
  add column if not exists cash_receipt_issued boolean not null default false,
  add column if not exists cash_receipt_issued_at timestamptz;

-- ── 고객: 본인 주문(입금대기)에 현금영수증 발행정보 설정 ──
--   금액 등 핵심 필드는 건드리지 않으므로 주문생성 RPC와 분리해 위험을 최소화한다.
create or replace function public.set_cash_receipt(
  p_order_id uuid,
  p_type     text,
  p_id       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  text := nullif(regexp_replace(coalesce(p_id, ''), '[^0-9]', '', 'g'), '');
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if p_type not in ('소득공제','지출증빙','발행안함') then
    raise exception '현금영수증 발행 방식이 올바르지 않습니다.';
  end if;
  if p_type = '소득공제' and (v_id is null or length(v_id) < 10 or length(v_id) > 11) then
    raise exception '소득공제용 휴대폰 번호를 정확히 입력해 주세요.';
  end if;
  if p_type = '지출증빙' and (v_id is null or length(v_id) <> 10) then
    raise exception '지출증빙용 사업자등록번호 10자리를 정확히 입력해 주세요.';
  end if;
  if p_type = '발행안함' then v_id := null; end if;

  update public.orders
     set cash_receipt_type = p_type,
         cash_receipt_id   = v_id
   where id = p_order_id
     and user_id = v_uid
     and status = '입금대기';
  if not found then
    raise exception '현금영수증 정보를 저장할 수 없습니다. (이미 처리된 주문이거나 권한이 없습니다)';
  end if;
end;
$$;

grant execute on function public.set_cash_receipt(uuid, text, text) to authenticated;

-- ── 관리자: 수기 발행 완료/대기 토글 ──
create or replace function public.mark_cash_receipt_issued(
  p_order_id uuid,
  p_issued   boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  update public.orders
     set cash_receipt_issued    = p_issued,
         cash_receipt_issued_at = case when p_issued then now() else null end
   where id = p_order_id;
end;
$$;

grant execute on function public.mark_cash_receipt_issued(uuid, boolean) to authenticated;
