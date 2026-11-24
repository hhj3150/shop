-- #253 후속 — 독립 검토가 찾은 결함 (2026-11-24)
--
-- 1) 다음 연장이 원주문 주소로 되돌아간다
--    #253 으로 연장분이 자기 받는 곳(B)을 가질 수 있게 됐는데, request_renewal 은 받는 곳을
--    여전히 '원주문'(A)에서 복사했다. 그래서 B 로 받던 손님이 한 번 더 연장하면 폼에 A 가 뜨고,
--    그대로 신청하면 연장 2회차가 옛 주소 A 로 나간다(배송비도 A 기준).
--    → 기본값은 '마지막 확정 블록'(가장 최근에 입금확인된 연장, 없으면 원주문)의 받는 곳.
--
-- 2) PayAction '입금 완료' 알림이 회원이 아니라 연장분 받는 분에게 간다
--    order_orderer_contact 는 선물일 때만 회원 프로필 번호를 돌려주고, 나머지는 주문의
--    배송 연락처(ship_phone)를 돌려줬다. 연장분 받는 분을 부모님 등으로 바꾸면 돈을 낸 적 없는
--    분에게 입금 완료 문자가 간다(2026-10 renewal-notify 사고와 같은 꼴).
--    → 회원의 연장 주문이면 회원 프로필의 번호·이름을 돌려준다.
--
-- 3) 내 정보 저장이 '연장분만 따로 정한 받는 곳'을 조용히 덮어쓴다
--    sync_my_order_shipping 은 본인 주문 전부를 프로필로 덮는다. 전화번호만 고쳐도 연장분 주소 B 가
--    프로필 주소 A 로 돌아간다. → orders.ship_to_custom 표시를 두고, 표시된 주문은 건너뛴다.
--    (request_renewal 에 p_ship 을 준 경우, set_my_renewal_ship_to, 관리자 주문별 배송지 수정이 켠다.)
--
-- 4) set_my_renewal_ship_to 의 배송비 판정을 '저장된 우편번호'가 아니라 '실제 청구한 회당 배송비'로.

-- ── 3) 표시 칸 ────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists ship_to_custom boolean not null default false;
comment on column public.orders.ship_to_custom is
  '이 주문(연장분)의 받는 곳을 따로 정했는가. true 면 내 정보·회원 정보 동기화가 덮어쓰지 않는다.';

-- 이미 원주문과 다른 받는 곳을 가진 연장 주문(운영 2건)은 따로 정한 것으로 본다.
update public.orders r
   set ship_to_custom = true
  from public.subscription_slots s
  join public.orders o on o.id = s.order_id
 where r.renews_slot_id = s.id
   and r.status <> '취소'
   and (coalesce(r.ship_address, '')        <> coalesce(o.ship_address, '')
     or coalesce(r.ship_address_detail, '') <> coalesce(o.ship_address_detail, '')
     or coalesce(r.ship_postcode, '')       <> coalesce(o.ship_postcode, '')
     or coalesce(r.ship_name, '')           <> coalesce(o.ship_name, '')
     or coalesce(r.ship_phone, '')          <> coalesce(o.ship_phone, ''));

-- ── 1)·3) 연장 신청 ──────────────────────────────────────────────────────────
--   운영 정의(#253, 2026-11-24)에서 바뀐 곳은 '받는 곳 원본(v_ship_src)'과 ship_to_custom 뿐이다.
create or replace function public.request_renewal(
  p_slot_id bigint, p_items jsonb, p_period integer, p_delivery_day text, p_ship jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid          uuid := auth.uid();
  v_slot         record;
  v_src          record;
  v_ship_src     record;
  v_rate         numeric;
  v_weeks        int;
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_price        int;
  v_stock        int;
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_taken        int;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
  v_ship         jsonb;
  v_ship_name    text;
  v_ship_phone   text;
  v_ship_post    text;
  v_ship_addr    text;
  v_ship_detail  text;
  v_ship_memo    text;
  v_custom       boolean;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select * into v_slot
    from public.subscription_slots
   where id = p_slot_id and user_id = v_uid and status = '활성'
   for update;
  if not found then raise exception '연장할 수 있는 활성 구독이 아닙니다.'; end if;

  if exists (select 1 from public.orders
              where renews_slot_id = p_slot_id and status = '입금대기') then
    raise exception '이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.';
  end if;

  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;

  if p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '연장할 품목이 없습니다.';
  end if;

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  -- 받는 곳 기본값 = 마지막 확정 블록(가장 최근 입금확인 연장, 없으면 원주문).
  --   블록 순서는 배송 명단과 같은 created_at, id 순이다(lib/slot-blocks.ts buildRawBlocks).
  select * into v_ship_src
    from public.orders
   where renews_slot_id = p_slot_id
     and status in ('입금확인', '배송준비', '배송중', '배송완료')
   order by created_at desc, id desc
   limit 1;
  if not found then
    select * into v_ship_src from public.orders where id = v_slot.order_id;
  end if;

  v_ship_name   := v_ship_src.ship_name;
  v_ship_phone  := v_ship_src.ship_phone;
  v_ship_post   := v_ship_src.ship_postcode;
  v_ship_addr   := v_ship_src.ship_address;
  v_ship_detail := v_ship_src.ship_address_detail;
  v_ship_memo   := v_ship_src.memo;
  v_custom      := coalesce(v_ship_src.ship_to_custom, false);

  v_ship := public._clean_ship_to(p_ship);
  if v_ship is not null and coalesce(v_src.delivery_method, '택배') <> '방문수령' then
    if v_ship->>'name' is null then raise exception '받는 분 이름을 입력해 주세요.'; end if;
    if length(coalesce(v_ship->>'phone', '')) < 10 then raise exception '받는 분 연락처를 정확히 입력해 주세요.'; end if;
    if v_ship->>'address' is null then raise exception '받는 곳 주소를 입력해 주세요.'; end if;
    v_ship_name   := v_ship->>'name';
    v_ship_phone  := v_ship->>'phone';
    v_ship_post   := v_ship->>'postcode';
    v_ship_addr   := v_ship->>'address';
    v_ship_detail := v_ship->>'address_detail';
    v_custom      := true;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    select price, name, volume, stock into v_price, v_name, v_volume, v_stock
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    if v_stock = 0 then
      raise exception '품절된 상품입니다: %', v_pid;
    end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_list < 24000 then
    raise exception '회당 최소 상품 금액은 정가 기준 24,000원입니다.';
  end if;

  if p_delivery_day <> v_slot.delivery_day then
    if exists (select 1 from public.subscription_slots
                where user_id = v_uid and delivery_day = p_delivery_day and status <> '해지') then
      raise exception '이미 그 요일에 구독이 있어 요일을 변경할 수 없습니다.';
    end if;
    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = p_delivery_day;
    if v_taken >= 100 then
      raise exception '선택한 요일이 마감되어 변경할 수 없습니다.';
    end if;
  end if;

  v_shipping := case
    when v_src.delivery_method = '방문수령' then 0
    else (case when public.is_special_delivery_postcode(v_ship_post) then 5000 else 4000 end) * v_weeks
  end;
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message, renews_slot_id, delivery_method, ship_to_custom
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_ship_name, v_ship_phone, v_ship_post,
    v_ship_addr, v_ship_detail, v_ship_memo,
    coalesce(v_src.is_gift, false), v_src.gifter_name, v_src.gift_message,
    p_slot_id, v_src.delivery_method, v_custom
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := (v_item->>'qty')::int;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, p_delivery_day, v_qty, v_unit);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$$;

-- ── 3)·4) 연장분 받는 곳 변경 ───────────────────────────────────────────────────
create or replace function public.set_my_renewal_ship_to(p_order_id uuid, p_ship jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := auth.uid();
  v_o    record;
  v_ship jsonb := public._clean_ship_to(p_ship);
  v_charged_special boolean;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.user_id is distinct from v_uid then
    raise exception '본인 주문만 바꿀 수 있습니다.';
  end if;
  if v_o.renews_slot_id is null then
    raise exception '연장 주문이 아닙니다.';
  end if;
  if v_o.status not in ('입금대기', '입금확인') then
    raise exception '이미 배송이 시작된 연장분입니다. 받는 곳 변경은 고객센터로 말씀해 주세요.';
  end if;
  if exists (select 1 from public.shipment_log l where l.order_id = p_order_id) then
    raise exception '이미 배송이 시작된 연장분입니다. 받는 곳 변경은 고객센터로 말씀해 주세요.';
  end if;
  if coalesce(v_o.delivery_method, '택배') = '방문수령' then
    raise exception '방문수령 구독은 받는 곳이 없습니다.';
  end if;

  if v_ship is null or v_ship->>'name' is null then raise exception '받는 분 이름을 입력해 주세요.'; end if;
  if length(coalesce(v_ship->>'phone', '')) < 10 then raise exception '받는 분 연락처를 정확히 입력해 주세요.'; end if;
  if v_ship->>'address' is null then raise exception '받는 곳 주소를 입력해 주세요.'; end if;

  -- 실제로 청구한 회당 배송비가 도서산간(5,000) 기준이었는지. 저장된 우편번호는 동기화로
  --   바뀌었을 수 있어 근거가 못 된다. 금액은 PayAction 에 이미 등록돼 바꿀 수 없다.
  v_charged_special := coalesce(v_o.shipping_fee, 0) >= 5000 * greatest(coalesce(v_o.block_weeks, 1), 1);
  if v_charged_special is distinct from public.is_special_delivery_postcode(v_ship->>'postcode') then
    raise exception '제주·도서산간 여부가 달라져 배송비가 바뀌는 주소입니다. %',
      case when v_o.status = '입금대기'
           then '연장 신청을 취소하고 새 주소로 다시 신청해 주세요.'
           else '고객센터로 말씀해 주세요.' end;
  end if;

  update public.orders
     set ship_name           = v_ship->>'name',
         ship_phone          = v_ship->>'phone',
         ship_postcode       = v_ship->>'postcode',
         ship_address        = v_ship->>'address',
         ship_address_detail = v_ship->>'address_detail',
         ship_to_custom      = true
   where id = p_order_id;

  insert into public.order_events (order_id, event, reason, actor_id, meta)
  values (p_order_id, 'renewal_ship_to_changed', '연장분 받는 곳 변경(지금 기간은 그대로)', v_uid,
          jsonb_build_object('before', jsonb_build_object(
                               'name', v_o.ship_name, 'postcode', v_o.ship_postcode,
                               'address', v_o.ship_address, 'address_detail', v_o.ship_address_detail),
                             'after', v_ship - 'phone'));

  return jsonb_build_object('order_id', p_order_id, 'ok', true);
end;
$$;

-- ── 3) 내 정보 동기화 — 따로 정한 받는 곳은 건너뛴다 ────────────────────────────
--   운영 정의(2026-11-24 pg_get_functiondef)에 'and not ship_to_custom' 만 더했다.
create or replace function public.sync_my_order_shipping(
  p_name text, p_phone text, p_postcode text, p_address text, p_address_detail text
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if coalesce(btrim(p_address), '') = '' then return 0; end if;

  update public.orders
     set ship_name           = coalesce(nullif(btrim(coalesce(p_name, '')), ''), ship_name),
         ship_phone          = coalesce(nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), ''), ship_phone),
         ship_postcode       = nullif(btrim(coalesce(p_postcode, '')), ''),
         ship_address        = btrim(p_address),
         ship_address_detail = nullif(btrim(coalesce(p_address_detail, '')), '')
   where user_id = v_uid
     and coalesce(is_gift, false) = false
     and not ship_to_custom
     and status <> '취소';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 2) PayAction 입금 완료 알림 수신처 ─────────────────────────────────────────
--   운영 정의에 '회원의 연장 주문이면 프로필 번호·이름' 을 더했다. orderer_name 은 새 필드
--   (옛 라우트는 무시한다 — 번호만 고쳐져도 엉뚱한 분에게 가는 일은 막힌다).
create or replace function public.order_orderer_contact(p_order_no text, p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_expected text;
  v_o        record;
  v_phone    text;
  v_name     text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select o.user_id, o.is_gift, o.ship_phone, o.renews_slot_id
    into v_o
    from public.orders o
   where o.order_no = p_order_no;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- 선물: 보내는 분(회원). 연장: 돈을 내는 사람은 회원이다 — 연장분 받는 분이 따로 있어도.
  if v_o.user_id is not null and (v_o.is_gift or v_o.renews_slot_id is not null) then
    select nullif(trim(coalesce(p.phone, '')), ''), nullif(trim(coalesce(p.name, '')), '')
      into v_phone, v_name
      from public.profiles p where p.id = v_o.user_id;
  end if;

  return jsonb_build_object(
    'found', true,
    'orderer_phone', coalesce(v_phone, nullif(trim(coalesce(v_o.ship_phone, '')), '')),
    'orderer_name', case when v_o.renews_slot_id is not null and not coalesce(v_o.is_gift, false)
                         then v_name end
  );
end;
$$;
