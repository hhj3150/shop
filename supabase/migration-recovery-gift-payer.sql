-- 미입금 리마인드 ② — 선물 주문은 '보낸 분'(주문자)에게 보낸다.
--
--   문제:
--     payment_recovery_targets 가 수신처를 orders.ship_phone(배송받는 분)으로만 내려준다.
--     선물 주문이 하루 이상 미입금으로 남으면 D1·D2 '입금 안내' 문자가 받는 분에게 간다.
--       · 돈을 낼 사람이 아닌 사람에게 입금을 독촉하고,
--       · 아직 전해지지 않은 선물을 미리 알려 버린다.
--     (2026-08-28 점검 시점까지 실제 발생 0건 — 선물 주문이 모두 당일 입금됐다. 구멍만 남아 있었다.)
--
--   해법:
--     is_gift = true 면 주문자 프로필(profiles.name/phone)을 수신처로 내려준다.
--     선물이 아니거나 주문자 연락처가 없으면 종전대로 배송 연락처를 쓴다(발송 누락 방지).
--     선물 주문은 회원만 가능해(게스트는 선물 토글 없음) user_id 가 항상 있다.
--
--   나머지(시크릿게이트·입금대기 필터·단계 원장 dedup)는 100% 보존. 멱등(create or replace).
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration).

create or replace function public.payment_recovery_targets(p_secret text)
returns table (
  order_id         uuid,
  created_at       timestamptz,
  ship_name        text,
  ship_phone       text,
  order_no         text,
  total_amount     integer,
  has_subscription boolean,
  sent_stages      text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
    select o.id,
           o.created_at,
           -- 선물이면 보낸 분(주문자) 이름·연락처. 없으면 배송 정보로 폴백.
           case when o.is_gift then coalesce(o.gifter_name, pr.name, o.ship_name)
                else o.ship_name end,
           case when o.is_gift then coalesce(pr.phone, o.ship_phone)
                else o.ship_phone end,
           o.order_no, o.total_amount, o.has_subscription,
           coalesce(
             array_agg(r.stage) filter (where r.stage is not null),
             '{}'::text[]
           ) as sent_stages
      from public.orders o
      left join public.profiles pr on pr.id = o.user_id
      left join public.order_reminders r on r.order_id = o.id
     where o.status = '입금대기'
     group by o.id, pr.name, pr.phone;
end;
$$;

revoke all on function public.payment_recovery_targets(text) from public;
grant execute on function public.payment_recovery_targets(text) to anon;

-- 검증
--   select order_no, ship_name, ship_phone from public.payment_recovery_targets('<secret>');
--   → 선물 주문 행의 연락처가 '주문자' 번호여야 한다(받는 분 번호가 아니라).
