-- 비회원 주문조회 (주문번호 + 전화번호).
--
-- 배경: 게스트 단품 주문(create_guest_once_order)은 가능하지만, 주문 후 상태를 볼 수 있는
--   경로가 전화 문의뿐이었다(완료 페이지 안내문). 국내 쇼핑몰 기본 기능인
--   '비회원 주문조회'를 추가한다 — 주문번호 + 주문 시 입력한 전화번호가 모두 일치할 때만
--   제한된 필드를 돌려준다.
--
-- 보안 설계:
--   · SECURITY DEFINER — RLS 를 우회하되 반환 필드를 최소화한다(주소·연락처 미반환).
--   · 인증쌍: order_no(랜덤 4자리 포함) + ship_phone 완전 일치. 이름은 첫 글자만 노출.
--   · 미일치·입력 미달이면 null (존재 여부를 구분해 노출하지 않는다).
--   · 회원 주문도 같은 쌍으로 조회 가능(로그인 없이 상태 확인) — 반환 필드가 최소라 안전.
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.

create or replace function public.lookup_order_by_no_phone(p_order_no text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_no    text := trim(coalesce(p_order_no, ''));
  v_order record;
  v_items jsonb;
  v_ship  jsonb;
begin
  -- 입력 미달은 조회 시도 자체를 거절(무차별 대입 억제).
  if length(v_no) < 8 or length(v_phone) < 10 then
    return null;
  end if;

  select id, order_no, status, order_type, created_at, ship_date,
         total_amount, shipping_fee, delivery_method, ship_name
    into v_order
    from public.orders
   where order_no = v_no
     and ship_phone = v_phone
   limit 1;
  if not found then return null; end if;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'name', product_name, 'volume', volume, 'qty', qty, 'unitPrice', unit_price
           ) order by product_name),
           '[]'::jsonb)
    into v_items
    from public.order_items
   where order_id = v_order.id;

  -- 송장 기록이 있는 회차만(비어 있는 예정 회차는 제외).
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'shipDate',    to_char(ship_date, 'YYYY-MM-DD'),
             'courier',     courier,
             'trackingNo',  tracking_no,
             'shippedAt',   shipped_at,
             'deliveredAt', delivered_at
           ) order by ship_date),
           '[]'::jsonb)
    into v_ship
    from public.shipment_log
   where order_id = v_order.id
     and (courier is not null or tracking_no is not null
          or shipped_at is not null or delivered_at is not null);

  return jsonb_build_object(
    'orderNo',        v_order.order_no,
    'status',         v_order.status,
    'orderType',      v_order.order_type,
    'createdAt',      v_order.created_at,
    'shipDate',       case when v_order.ship_date is null then null
                           else to_char(v_order.ship_date, 'YYYY-MM-DD') end,
    'totalAmount',    v_order.total_amount,
    'shippingFee',    v_order.shipping_fee,
    'deliveryMethod', v_order.delivery_method,
    -- 이름 마스킹: 첫 글자만 노출(개인정보 최소화).
    'shipName',       case when coalesce(v_order.ship_name, '') = '' then null
                           else left(v_order.ship_name, 1) || '**' end,
    'items',          v_items,
    'shipments',      v_ship
  );
end;
$$;

grant execute on function public.lookup_order_by_no_phone(text, text) to anon, authenticated;
