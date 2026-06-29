-- 정기구독 배송지 동기화 — 프로필 주소 변경을 '진행 중인 구독'에 반영.
--
-- 배경: 주문(구독 포함)은 주문 시점의 배송지를 ship_* 스냅샷으로 따로 저장한다(프로필과 별개).
--   그래서 회원이 프로필 주소를 바꿔도 이미 만들어진 구독 주문의 배송지는 그대로 남아,
--   이사한 회원의 정기배송이 옛 주소로 계속 나가는 사고가 생긴다.
--
-- 정책(운영자 결정): 프로필 주소를 바꾸면 그 회원의 '진행 중인 정기구독'(선물 제외·취소 제외)의
--   배송지 스냅샷도 함께 갱신해 '향후' 배송이 새 주소로 나가게 한다. 이미 발송된 회차에는
--   영향이 없다(과거 배송 레코드는 별도 보존). 단품 주문은 건드리지 않는다.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 보안: SECURITY DEFINER + auth.uid() 로 '본인' 주문만 갱신한다(타인 주문 갱신 불가).
--   관리자 화면은 orders_update_admin 정책으로 직접 갱신하므로 이 RPC가 필요 없다(회원 본인용).

create or replace function public.sync_my_subscription_shipping(
  p_postcode       text,
  p_address        text,
  p_address_detail text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  -- 주소가 비면(빈 문자) 동기화하지 않는다 — 실수로 배송지를 지우는 사고 방지.
  if coalesce(btrim(p_address), '') = '' then return 0; end if;

  update public.orders
     set ship_postcode       = nullif(btrim(coalesce(p_postcode, '')), ''),
         ship_address        = btrim(p_address),
         ship_address_detail = nullif(btrim(coalesce(p_address_detail, '')), '')
   where user_id = v_uid
     and order_type = '구독'
     and coalesce(is_gift, false) = false
     and status <> '취소';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.sync_my_subscription_shipping(text, text, text) to authenticated;
