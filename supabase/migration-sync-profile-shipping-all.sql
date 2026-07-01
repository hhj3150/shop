-- 고객정보(프로필) 변경 시 '내 진행 주문'의 배송정보 전체 동기화 — 이름·연락처·주소.
--
-- 배경: 기존 sync_my_subscription_shipping 은 (1) 정기구독 주문만, (2) 주소만 갱신했다.
--   그래서 회원이 개인정보를 바꿔도 단품 주문이나 받는 이름·연락처는 옛 값 그대로 남아,
--   '고객정보'와 '배송정보'가 어긋나는 사고가 났다(예: 단품 주문 회원이 이사 후에도
--   배송정보 주소가 그대로).
--
-- 정책(운영자 결정): 개인정보를 바꾸면 그 회원의 '진행 중인 주문'(선물 제외·취소 제외)의
--   배송정보 스냅샷을 이름·연락처·주소 모두 새 값으로 맞춘다. 단품·구독을 모두 포함한다.
--   선물 주문은 받는 분 주소가 따로이므로 건드리지 않는다.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 보안: SECURITY DEFINER + auth.uid() 로 '본인' 주문만 갱신한다(타인 주문 갱신 불가).
--   관리자 화면은 orders_update_admin 정책으로 직접 갱신하므로 이 RPC가 필요 없다(회원 본인용).

create or replace function public.sync_my_order_shipping(
  p_name           text,
  p_phone          text,
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
     set ship_name           = coalesce(nullif(btrim(coalesce(p_name, '')), ''), ship_name),
         ship_phone          = coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), ''), ship_phone),
         ship_postcode       = nullif(btrim(coalesce(p_postcode, '')), ''),
         ship_address        = btrim(p_address),
         ship_address_detail = nullif(btrim(coalesce(p_address_detail, '')), '')
   where user_id = v_uid
     and coalesce(is_gift, false) = false
     and status <> '취소';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.sync_my_order_shipping(text, text, text, text, text) to authenticated;

-- 더 이상 쓰지 않는 옛 함수 정리(주소만·구독만 갱신하던 버전).
drop function if exists public.sync_my_subscription_shipping(text, text, text);

-- ── 검증(선택) — 적용 후 확인 ──
--   -- 회원 세션에서 본인 프로필을 바꾸면 진행 중인 단품·구독 주문의 ship_name/phone/주소가
--   -- 새 값으로 따라오는지, 선물·취소 주문은 그대로인지 확인한다.
