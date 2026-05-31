-- 송영신목장 독립몰 — 자동이체 · 회원제 · 정기구독 전용 스키마
-- Supabase SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- 인증(이메일/비밀번호)은 Supabase Auth(auth.users)가 담당합니다.

-- ───────────────────────────────────────────────────────────
-- 1. 회원 프로필 (배송·문자 발송에 필요한 최소 정보)
-- ───────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null,
  phone        text not null,            -- 문자 발송용 (010xxxxxxxx)
  postcode     text,
  address      text,                     -- 기본 주소
  address_detail text,                   -- 상세 주소
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- 광고성(임의) 문자 수신동의. 정보통신망법상 광고 문자는 사전 수신동의가 필요하다.
--   배송·입금 등 거래 관련 정보성 문자는 동의와 무관하게 발송 가능.
--   marketing_consent = 가입 시 [선택] 광고수신 동의 체크 여부.
--   동의하지 않은 회원은 관리자 단체발송에서 '광고' 발송 대상에 포함되지 않는다.
alter table public.profiles
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;

alter table public.profiles enable row level security;

-- ───────────────────────────────────────────────────────────
-- 1-1. 관리자 판별 함수 (RLS 재귀 방지를 위해 SECURITY DEFINER).
--      profiles.is_admin = true 인 계정만 관리자.
--      관리자 지정: update public.profiles set is_admin = true where id = '<auth uid>';
--      ※ profiles 테이블이 먼저 존재해야 하므로 테이블 생성 뒤에 둔다.
-- ───────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 본인 프로필만 조회/수정. 관리자는 Phase 2에서 service role로 접근.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 관리자는 모든 회원 프로필 조회 가능 (물류·연락용).
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

-- 권한 상승 차단: 일반 회원이 본인 프로필을 수정/생성할 때 is_admin 을 스스로
-- 켤 수 없도록 트리거로 고정한다. (RLS with check 는 OLD 값을 참조할 수 없어 트리거 사용)
-- 관리자(is_admin()=true)만 다른 회원의 is_admin 을 변경할 수 있다.
create or replace function public.protect_profile_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- 신규 가입자는 관리자 권한을 스스로 부여할 수 없다.
    if coalesce(new.is_admin, false) and not public.is_admin() then
      new.is_admin := false;
    end if;
    return new;
  end if;
  -- UPDATE: 관리자가 아니면 is_admin 변경 시도를 무시하고 기존 값 유지.
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_admin on public.profiles;
create trigger trg_protect_profile_admin
  before insert or update on public.profiles
  for each row execute function public.protect_profile_admin();

-- ───────────────────────────────────────────────────────────
-- 2. 주문 (무통장입금 · 4주분 선입금)
--    status 흐름: 입금대기 → 입금확인 → 배송준비 → 배송중 → 배송완료 / 취소
--    상태가 배송준비·배송중·배송완료로 바뀌면 Phase 2에서 소비자에게 문자 발송.
-- ───────────────────────────────────────────────────────────
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  order_no      text not null unique,          -- 사람이 읽는 주문번호 (입금자 대조용)
  status        text not null default '입금대기'
                check (status in ('입금대기','입금확인','배송준비','배송중','배송완료','취소')),
  has_subscription boolean not null default true,
  block_weeks   integer not null default 4,    -- 한 번 입금 = 몇 주분 (주 1회 × block_weeks 회)
  depositor_name text,                          -- 입금자명 (통장 대조용)
  total_amount  integer not null,
  -- 배송지 스냅샷 (주문 시점 정보 보존)
  ship_name     text not null,
  ship_phone    text not null,
  ship_postcode text,
  ship_address  text not null,
  ship_address_detail text,
  memo          text,
  created_at    timestamptz not null default now()
);

-- 단품(1회) 주문 지원 컬럼. order_type='단품'이면 구독 슬롯 없이 ship_date에 발송.
alter table public.orders
  add column if not exists order_type text not null default '구독'
    check (order_type in ('구독','단품')),
  add column if not exists ship_date date,
  add column if not exists shipping_fee integer not null default 0,
  -- 구독 기간(개월). 1/2/3 중 하나. 전체 기간분(주 1회 × 4주 × 개월)을 한 번에 입금.
  add column if not exists period_months integer not null default 1,
  -- 배송 추적: 관리자가 발송 시 택배사·송장번호 입력 → 고객 배송조회.
  add column if not exists courier text,
  add column if not exists tracking_no text,
  add column if not exists shipped_at date,
  -- 선물하기: is_gift=true 이면 ship_*(이름/전화/주소)는 받는 사람 정보.
  --   gifter_name = 보내는 분(주문자) 표시명, gift_message = 선물 메시지(선택).
  add column if not exists is_gift boolean not null default false,
  add column if not exists gifter_name text,
  add column if not exists gift_message text,
  -- 구독 연장 주문: 이 주문이 연장하는 기존 슬롯. NULL 이면 일반(신규) 주문.
  --   연장 주문은 새 슬롯/품목을 만들지 않고, 입금확인 시 해당 슬롯의 extended_weeks 를 늘린다.
  add column if not exists renews_slot_id bigint,
  -- 현금영수증(무통장입금 수기 발행): 고객이 발행 방식·식별번호 선택 → 관리자가 홈택스 발행.
  --   set_cash_receipt / mark_cash_receipt_issued RPC 는 migration-cash-receipt.sql 참고.
  add column if not exists cash_receipt_type text not null default '발행안함'
    check (cash_receipt_type in ('소득공제','지출증빙','발행안함')),
  add column if not exists cash_receipt_id text,
  add column if not exists cash_receipt_issued boolean not null default false,
  add column if not exists cash_receipt_issued_at timestamptz;

alter table public.orders enable row level security;

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (auth.uid() = user_id);

-- 주문 INSERT 는 클라이언트 직접 불가 — 금액 위·변조 차단을 위해
-- SECURITY DEFINER RPC(create_subscription_order / create_once_order)로만 생성한다.
-- (이전 orders_insert_own 정책은 제거됨)

-- 관리자는 모든 주문 조회/상태변경(자동이체 확인·배송 상태) 가능.
drop policy if exists "orders_select_admin" on public.orders;
create policy "orders_select_admin" on public.orders
  for select using (public.is_admin());

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin" on public.orders
  for update using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 3. 주문 품목 (정기구독 전용 · 매주 1회 고정, 요일은 월~금 택1)
-- ───────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   text not null,
  product_name text not null,
  volume       text not null,
  delivery_day text check (delivery_day in ('mon','tue','wed','thu','fri')), -- 단품은 null
  qty          integer not null check (qty > 0),
  unit_price   integer not null
);

-- 단품 주문 도입 전 생성된 테이블을 위해 NOT NULL 제약 해제(이미 nullable이면 무시됨).
alter table public.order_items alter column delivery_day drop not null;

alter table public.order_items enable row level security;

drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

-- 품목 INSERT 도 클라이언트 직접 불가 — 주문 생성 RPC 내부에서만 기록한다.
-- (이전 order_items_insert_own 정책은 제거됨)

-- 관리자는 모든 주문 품목 조회 가능 (요일별·제품별 수량 집계).
drop policy if exists "order_items_select_admin" on public.order_items;
create policy "order_items_select_admin" on public.order_items
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 4. 정기구독 슬롯 (요일별 선착순 100명 · 전체 500명)
--    100명이 차면 status='대기' 로 대기자 등록 → Phase 2에서 빈 자리 발생 시 문자 안내.
--    started_at = 구독 시작일 (장기구독 할인 산정: 6개월↑ 15%, 1년↑ 20%).
--    동시성(100명 정확 마감)은 Phase 2의 RPC/함수에서 보강.
-- ───────────────────────────────────────────────────────────
-- status:
--   신청 = 신청 완료, 자동이체 확인 대기 (정원 100 안에 자리 점유)
--   활성 = 자동이체 확인된 정회원 (자리 점유, started_at 부여 → 연차 할인 기준)
--   대기 = 정원 100 초과 대기자 (자리 미점유, 빈 자리 생기면 승급)
--   해지 = 해지됨
create table if not exists public.subscription_slots (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  delivery_day text not null check (delivery_day in ('mon','tue','wed','thu','fri')),
  status       text not null default '신청'
               check (status in ('신청','활성','대기','해지')),
  started_at   date,                         -- 활성 전환(첫 자동이체 확인) 시점 = 구독 연차 기준일
  order_id     uuid references public.orders (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 한 회원은 요일별로 하나의 슬롯만 점유.
create unique index if not exists subscription_slots_user_day_uniq
  on public.subscription_slots (user_id, delivery_day)
  where status <> '해지';

-- Phase 2: 일시정지/재개. 총 배송 횟수는 보존하고, 정지 기간만큼 종료일이 뒤로 밀린다.
--   paused      = 현재 일시정지 중인지
--   paused_at   = 현재 정지 시작일 (재개 시 누적에 합산하고 null로 되돌림)
--   paused_days = 과거 완료된 정지들의 누적 일수 (스케줄은 started_at + 주차 + paused_days 로 산출)
alter table public.subscription_slots
  add column if not exists paused boolean not null default false,
  add column if not exists paused_at date,
  add column if not exists paused_days integer not null default 0;

-- 구독 해지(환불 동반): 남은 회차분을 환불하고 사유·환불계좌를 기록.
--   cancel_reason  = 회원이 입력한 중지 사유
--   refund_account = 회원 본인 환불 수취 계좌 (회원 직접 입력)
--   refund_amount  = 남은(미배송) 회차 × (회당 상품가 + 배송비) — 클라이언트 산출, 관리자 검증 후 송금
--   cancelled_at   = 해지일
alter table public.subscription_slots
  add column if not exists cancel_reason text,
  add column if not exists refund_account text,
  add column if not exists refund_amount integer,
  add column if not exists cancelled_at date;

-- 구독 연장: 연장(재입금) 입금확인 시마다 4회씩 누적되는 추가 배송 회차.
--   총 배송 회차 = 원 주문 block_weeks + extended_weeks. 기존 슬롯을 그대로 이어가 자리 유지.
alter table public.subscription_slots
  add column if not exists extended_weeks integer not null default 0;

alter table public.subscription_slots enable row level security;

drop policy if exists "slots_select_own" on public.subscription_slots;
create policy "slots_select_own" on public.subscription_slots
  for select using (auth.uid() = user_id);

-- 슬롯 INSERT 도 클라이언트 직접 불가 — 정원 마감을 원자적으로 처리하기 위해
-- create_subscription_order RPC 내부에서만 등록한다(C3 동시성 보장).
-- (이전 slots_insert_own 정책은 제거됨)

-- 관리자는 모든 슬롯(활성·대기자) 조회/변경 가능.
drop policy if exists "slots_select_admin" on public.subscription_slots;
create policy "slots_select_admin" on public.subscription_slots
  for select using (public.is_admin());

drop policy if exists "slots_update_admin" on public.subscription_slots;
create policy "slots_update_admin" on public.subscription_slots
  for update using (public.is_admin());

-- 회원 본인의 활성 구독을 일시정지. 소유권은 함수 내부에서 검증(상태·이중정지 방지).
-- SECURITY DEFINER 라 RLS update 권한을 회원에게 넓게 열지 않아도 paused 필드만 토글된다.
create or replace function public.pause_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscription_slots
     set paused = true,
         paused_at = current_date
   where id = p_slot_id
     and user_id = auth.uid()
     and status = '활성'
     and paused = false;
  if not found then
    raise exception '일시정지할 수 있는 활성 구독이 아닙니다.';
  end if;
end;
$$;

-- 정지 중인 구독을 재개. 이번 정지 일수를 누적(paused_days)에 합산하고 정지 상태 해제.
create or replace function public.resume_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscription_slots
     set paused = false,
         paused_days = paused_days + (current_date - paused_at),
         paused_at = null
   where id = p_slot_id
     and user_id = auth.uid()
     and paused = true
     and paused_at is not null;
  if not found then
    raise exception '재개할 수 있는 정지 상태가 아닙니다.';
  end if;
end;
$$;

grant execute on function public.pause_subscription(bigint) to authenticated;
grant execute on function public.resume_subscription(bigint) to authenticated;

-- 회원 본인의 구독을 해지(환불 동반). 환불액은 클라이언트가 아닌 서버에서 재계산한다(C2).
--   환불액 = round(총입금액 / 총회차) × 남은(미배송) 회차.
--   남은 회차 산출은 lib/subscription-schedule.ts 의 규칙과 동일(정지 일수 반영).
-- 해지하면 unique index(status<>'해지')에서 빠져 해당 요일 슬롯이 다시 열린다.
drop function if exists public.cancel_subscription(bigint, text, text, integer);

create or replace function public.cancel_subscription(
  p_slot_id        bigint,
  p_reason         text,
  p_refund_account text
)
returns integer   -- 서버가 계산한 환불액(원)을 반환
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_weeks  int;
  v_total_amount int;
  v_started      date;
  v_paused       boolean;
  v_paused_at    date;
  v_paused_days  int;
  v_today        date := (now() at time zone 'Asia/Seoul')::date;
  v_elapsed      int;
  v_delivered    int;
  v_remaining    int;
  v_refund       int;
begin
  select s.started_at, s.paused, s.paused_at, s.paused_days,
         coalesce(o.block_weeks, 0), coalesce(o.total_amount, 0)
    into v_started, v_paused, v_paused_at, v_paused_days, v_total_weeks, v_total_amount
    from public.subscription_slots s
    left join public.orders o on o.id = s.order_id
   where s.id = p_slot_id
     and s.user_id = auth.uid()
     and s.status in ('활성','대기')
   for update of s;
  if not found then
    raise exception '해지할 수 있는 구독이 아닙니다.';
  end if;

  if v_started is null then
    v_remaining := v_total_weeks;
  else
    v_elapsed := (v_today - v_started)
      - (v_paused_days
         + case when v_paused and v_paused_at is not null
                then greatest(0, v_today - v_paused_at) else 0 end);
    if v_elapsed < 0 then
      v_delivered := 0;
    else
      v_delivered := least(v_total_weeks, (v_elapsed / 7) + 1);
    end if;
    v_remaining := greatest(0, v_total_weeks - v_delivered);
  end if;

  if v_total_weeks > 0 then
    v_refund := (round(v_total_amount::numeric / v_total_weeks) * v_remaining)::int;
  else
    v_refund := 0;
  end if;

  update public.subscription_slots
     set status         = '해지',
         paused         = false,
         paused_at      = null,
         cancel_reason  = p_reason,
         refund_account = p_refund_account,
         refund_amount  = v_refund,
         cancelled_at   = v_today
   where id = p_slot_id;

  return v_refund;
end;
$$;

grant execute on function public.cancel_subscription(bigint, text, text) to authenticated;

-- 입금 전(입금대기) 주문을 회원이 스스로 취소. 받은 돈이 없으므로 환불 절차는 없다.
--   - 본인 주문 + status='입금대기' 일 때만 허용. 입금확인된 주문은 cancel_subscription(해지+환불)로만.
--   - 연결된 미시작 슬롯(신청/대기)을 '해지'로 바꿔 선착순 자리를 즉시 반환한다.
create or replace function public.cancel_unpaid_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  select status into v_status
    from public.orders
   where id = p_order_id and user_id = v_uid
   for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;
  if v_status <> '입금대기' then
    raise exception '입금 전 주문만 취소할 수 있습니다. 이미 입금이 확인된 주문은 구독 해지·환불을 이용해 주세요.';
  end if;

  -- 연결된 미시작 슬롯(신청/대기) 해지 → 자리 반환(unique index 에서 빠짐)
  update public.subscription_slots
     set status        = '해지',
         cancel_reason  = '입금 전 구매 취소',
         cancelled_at   = v_today
   where order_id = p_order_id and user_id = v_uid and status in ('신청','대기');

  update public.orders set status = '취소' where id = p_order_id;
end;
$$;

grant execute on function public.cancel_unpaid_order(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────
-- 4-0. 구독 연장 (재입금으로 같은 슬롯 이어가기)
--   request_renewal: 활성 슬롯의 원 주문 품목으로 5% 재계산해 연장 주문(입금대기) 생성.
--   confirm_renewal_payment: 관리자가 연장 입금 확인 시 슬롯 extended_weeks += 4 (원자적).
-- ───────────────────────────────────────────────────────────
create or replace function public.request_renewal(p_slot_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_slot         record;
  v_src          record;
  v_rate         numeric;
  v_weeks        int := 4;       -- 1개월 = 4회
  v_item         record;
  v_price        int;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
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

  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  v_rate := public.period_discount(1);

  for v_item in
    select oi.product_id, oi.qty from public.order_items oi where oi.order_id = v_src.id
  loop
    select price into v_price from public.product_catalog where id = v_item.product_id and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_item.qty;
    v_per_list     := v_per_list + v_price * v_item.qty;
  end loop;

  if v_per_delivery <= 0 then raise exception '연장할 품목이 없습니다.'; end if;
  v_shipping := 4000 * v_weeks;  -- 배송비는 주문 금액과 무관하게 항상 자부담
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, renews_slot_id
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, 1, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$$;

grant execute on function public.request_renewal(bigint) to authenticated;

create or replace function public.confirm_renewal_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot  bigint;
  v_weeks int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  select renews_slot_id, block_weeks into v_slot, v_weeks
    from public.orders where id = p_order_id for update;
  if v_slot is null then raise exception '연장 주문이 아닙니다.'; end if;

  update public.orders set status = '입금확인' where id = p_order_id;
  update public.subscription_slots
     set extended_weeks = extended_weeks + v_weeks
   where id = v_slot;
end;
$$;

grant execute on function public.confirm_renewal_payment(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────
-- 4-1. 가격 권위 테이블 + 주문 생성 RPC (C1·C3)
--   가격은 product_catalog 가 유일한 출처. 주문 금액은 서버(DB)에서 재계산.
--   클라이언트의 orders/order_items/slots 직접 INSERT 권한은 제거되었으므로,
--   주문은 오직 아래 SECURITY DEFINER RPC 를 통해서만 생성된다.
-- ───────────────────────────────────────────────────────────
create table if not exists public.product_catalog (
  id        text primary key,
  name      text not null,
  volume    text not null,
  price     integer not null check (price >= 0),
  tax_free  boolean not null default false,
  active    boolean not null default true
);

insert into public.product_catalog (id, name, volume, price, tax_free) values
  ('milk-180',   'A2 저지 헤이밀크',     '180mL', 3500,  true),
  ('milk-750',   'A2 저지 헤이밀크',     '750mL', 12000, true),
  ('yogurt-180', 'A2 저지 플레인 요거트', '180mL', 4300,  false),
  ('yogurt-500', 'A2 저지 플레인 요거트', '500mL', 10000, false)
on conflict (id) do update set
  name     = excluded.name,
  volume   = excluded.volume,
  price    = excluded.price,
  tax_free = excluded.tax_free,
  active   = true;

alter table public.product_catalog enable row level security;

drop policy if exists "catalog_select_all" on public.product_catalog;
create policy "catalog_select_all" on public.product_catalog
  for select using (true);

drop policy if exists "catalog_insert_admin" on public.product_catalog;
create policy "catalog_insert_admin" on public.product_catalog
  for insert with check (public.is_admin());

drop policy if exists "catalog_update_admin" on public.product_catalog;
create policy "catalog_update_admin" on public.product_catalog
  for update using (public.is_admin());

create or replace function public.period_discount(p_months int)
returns numeric
language sql
immutable
as $$
  select case p_months
    when 1 then 0.05
    else null
  end;
$$;

create or replace function public.gen_order_no()
returns text
language sql
volatile
as $$
  select 'SY'
    || to_char((now() at time zone 'Asia/Seoul'), 'YYYYMMDD')
    || '-'
    || lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
$$;

-- C1: 정기구독 주문 생성 (서버측 금액 재계산 + C3 정원 잠금)
create or replace function public.create_subscription_order(
  p_items  jsonb,   -- [{product_id, delivery_day, qty}, ...]
  p_period int,     -- 1 (1개월 고정)
  p_ship   jsonb    -- {name, phone, postcode, address, addressDetail, depositorName, memo, isGift, gifterName, giftMessage}
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_rate         numeric;
  v_weeks        int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
  v_is_gift      boolean := coalesce((p_ship->>'isGift')::boolean, false);
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_day          text;
  v_price        int;
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_days         text[];
  v_slots        jsonb := '[]'::jsonb;
  v_taken        int;
  v_waitlist     int;
  v_waitlisted   boolean;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '장바구니가 비어 있습니다.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    v_day := v_item->>'delivery_day';
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    if v_day is null or v_day not in ('mon','tue','wed','thu','fri') then
      raise exception '배송 요일이 올바르지 않습니다.';
    end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_delivery < 25000 then
    raise exception '회당 최소 상품 금액은 25,000원입니다.';
  end if;
  v_shipping := 4000 * v_weeks;  -- 배송비는 주문 금액과 무관하게 항상 자부담
  v_total := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독',
    coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
    trim(p_ship->>'name'),
    regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
    nullif(trim(coalesce(p_ship->>'postcode','')),''),
    trim(p_ship->>'address'),
    nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
    nullif(trim(coalesce(p_ship->>'memo','')),''),
    v_is_gift,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := (v_item->>'qty')::int;
    v_day := v_item->>'delivery_day';
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, v_day, v_qty, v_unit);
  end loop;

  select array_agg(distinct (e->>'delivery_day')) into v_days
    from jsonb_array_elements(p_items) e;
  foreach v_day in array v_days loop
    perform pg_advisory_xact_lock(hashtext('slot_day:' || v_day));
    select count(*) filter (where status in ('신청','활성')),
           count(*) filter (where status = '대기')
      into v_taken, v_waitlist
      from public.subscription_slots
     where delivery_day = v_day;
    v_waitlisted := v_taken >= 100;
    insert into public.subscription_slots (user_id, delivery_day, status, order_id)
      values (v_uid, v_day, case when v_waitlisted then '대기' else '신청' end, v_order_id);
    v_slots := v_slots || jsonb_build_object(
      'deliveryDay', v_day,
      'position',    case when v_waitlisted then v_waitlist + 1 else v_taken + 1 end,
      'waitlisted',  v_waitlisted
    );
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'slots', v_slots);
end;
$$;

grant execute on function public.create_subscription_order(jsonb, int, jsonb) to authenticated;

-- C1: 단품(1회) 주문 생성 (서버측 금액 재계산 + KST 발송일)
create or replace function public.create_once_order(
  p_items jsonb,   -- [{product_id, qty}, ...]
  p_ship  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_subtotal  int := 0;
  v_shipping  int;
  v_total     int;
  v_order_id  uuid;
  v_order_no  text;
  v_is_gift   boolean := coalesce((p_ship->>'isGift')::boolean, false);
  v_item      jsonb;
  v_pid       text;
  v_qty       int;
  v_price     int;
  v_name      text;
  v_volume    text;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
  v_dow       int;
  v_ship      date;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '담은 제품이 없습니다.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select price into v_price from public.product_catalog where id = v_pid and active;
    if not found then raise exception '존재하지 않는 제품입니다: %', v_pid; end if;
    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  if v_subtotal < 25000 then
    raise exception '단품 최소 주문 금액은 25,000원입니다.';
  end if;
  v_shipping := 4000;  -- 배송비는 주문 금액과 무관하게 항상 자부담
  v_total := v_subtotal + v_shipping;

  v_dow := extract(dow from v_today)::int;  -- 0=일 … 6=토
  if v_dow = 6 then
    v_ship := v_today + 3;
  elsif v_dow = 0 then
    v_ship := v_today + 2;
  else
    v_ship := v_today + 1;
    if extract(dow from v_ship)::int = 6 then v_ship := v_ship + 2; end if;
  end if;

  if length(trim(coalesce(p_ship->>'name',''))) = 0
     or length(trim(coalesce(p_ship->>'address',''))) = 0
     or length(regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g')) < 10 then
    raise exception '받는 분·연락처·주소를 올바르게 입력해 주세요.';
  end if;

  v_order_no := public.gen_order_no();
  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription, block_weeks,
    order_type, ship_date, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, gifter_name, gift_message
  ) values (
    v_uid, v_order_no, v_total, v_shipping, false, 1,
    '단품', v_ship,
    coalesce(nullif(trim(coalesce(p_ship->>'depositorName','')),''), trim(p_ship->>'name')),
    trim(p_ship->>'name'),
    regexp_replace(coalesce(p_ship->>'phone',''), '[^0-9]', '', 'g'),
    nullif(trim(coalesce(p_ship->>'postcode','')),''),
    trim(p_ship->>'address'),
    nullif(trim(coalesce(p_ship->>'addressDetail','')),''),
    nullif(trim(coalesce(p_ship->>'memo','')),''),
    v_is_gift,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'gifterName','')),'') else null end,
    case when v_is_gift then nullif(trim(coalesce(p_ship->>'giftMessage','')),'') else null end
  ) returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then continue; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, null, v_qty, v_price);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'ship_date', to_char(v_ship, 'YYYY-MM-DD'));
end;
$$;

grant execute on function public.create_once_order(jsonb, jsonb) to authenticated;

-- ───────────────────────────────────────────────────────────
-- 5. 요일별 점유 현황 뷰 (집계 수치만 노출, 개인정보 없음, 정원 100/요일).
--    security_invoker=off(기본): 뷰 소유자(postgres) 권한으로 실행되어 RLS를
--    우회하므로, 미로그인 방문자도 전체 집계(잔여 인원)를 볼 수 있다.
--    taken = 신청+활성(정원 점유). 잔여 = 100 - taken. waitlist = 대기자 수.
-- ───────────────────────────────────────────────────────────
create or replace view public.subscription_day_count as
  with days as (
    select unnest(array['mon','tue','wed','thu','fri']) as delivery_day
  )
  select
    d.delivery_day,
    coalesce(count(s.id) filter (where s.status = '활성'), 0)::int as active,
    coalesce(count(s.id) filter (where s.status in ('신청','활성')), 0)::int as taken,
    coalesce(count(s.id) filter (where s.status = '대기'), 0)::int as waitlist,
    100 as capacity
  from days d
  left join public.subscription_slots s
    on s.delivery_day = d.delivery_day
  group by d.delivery_day;

-- 뷰는 익명(미로그인) 방문자도 잔여 수량을 볼 수 있어야 하므로 읽기 권한 부여.
grant select on public.subscription_day_count to anon, authenticated;

-- ───────────────────────────────────────────────────────────
-- 6. 소식 (관리자 공지 · 홈 게시)
--    관리자가 제목/본문/사진/유튜브 링크를 올리고 published=true 로 게시.
--    게시된 글은 누구나(미로그인 포함) 읽을 수 있다.
--    이미지는 storage 'news' 버킷에 업로드, cover_url 에 공개 URL 저장.
--    동영상은 youtube_id 만 저장하고 프론트에서 임베드.
-- ───────────────────────────────────────────────────────────
create table if not exists public.news (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  cover_url   text,
  youtube_id  text,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.news enable row level security;

-- 게시된 소식은 누구나 읽기.
drop policy if exists "news_select_published" on public.news;
create policy "news_select_published" on public.news
  for select using (published = true);

-- 관리자는 미게시 초안 포함 전체 조회/작성/수정/삭제.
drop policy if exists "news_select_admin" on public.news;
create policy "news_select_admin" on public.news
  for select using (public.is_admin());

drop policy if exists "news_insert_admin" on public.news;
create policy "news_insert_admin" on public.news
  for insert with check (public.is_admin());

drop policy if exists "news_update_admin" on public.news;
create policy "news_update_admin" on public.news
  for update using (public.is_admin());

drop policy if exists "news_delete_admin" on public.news;
create policy "news_delete_admin" on public.news
  for delete using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 6-1. 소식 이미지 스토리지 버킷 (공개 읽기, 관리자만 업로드)
-- ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('news', 'news', true)
on conflict (id) do nothing;

drop policy if exists "news_obj_read" on storage.objects;
create policy "news_obj_read" on storage.objects
  for select using (bucket_id = 'news');

drop policy if exists "news_obj_insert" on storage.objects;
create policy "news_obj_insert" on storage.objects
  for insert with check (bucket_id = 'news' and public.is_admin());

drop policy if exists "news_obj_delete" on storage.objects;
create policy "news_obj_delete" on storage.objects
  for delete using (bucket_id = 'news' and public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 7. 구매평 (제품별 별점 후기)
--    로그인 회원이 제품별로 1~5점 별점 + 후기 작성.
--    후기는 누구나(미로그인 포함) 읽을 수 있고, 이름은 프론트에서 마스킹(하현제→하**).
--    author_name 은 작성 시점 회원 이름 스냅샷.
-- ───────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  product_id   text not null,
  author_name  text not null,
  rating       smallint not null check (rating between 1 and 5),
  body         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists reviews_product_created_idx
  on public.reviews (product_id, created_at desc);

alter table public.reviews enable row level security;

-- 후기는 누구나 읽기.
drop policy if exists "reviews_select_all" on public.reviews;
create policy "reviews_select_all" on public.reviews
  for select using (true);

-- 로그인 회원은 본인 이름으로만 작성.
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own" on public.reviews
  for insert with check (auth.uid() = user_id);

-- 본인 후기 삭제.
drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own" on public.reviews
  for delete using (auth.uid() = user_id);

-- 관리자는 모든 후기 삭제(부적절 후기 정리).
drop policy if exists "reviews_delete_admin" on public.reviews;
create policy "reviews_delete_admin" on public.reviews
  for delete using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 8. 생산·재고 기록 (생산자용 — 날짜·제품별 생산계획/실제생산)
--    생산자가 날짜별로 제품의 계획·실제 생산량을 기록하고,
--    확정 구독 수요(요일별 필요수량)와 비교해 부족·잉여를 본다.
--    (prod_date, product_key) 가 유니크 → 같은 날 같은 제품은 upsert.
--    관리자(생산자 포함, is_admin)만 조회·작성·수정·삭제.
-- ───────────────────────────────────────────────────────────
create table if not exists public.production_logs (
  id           uuid primary key default gen_random_uuid(),
  prod_date    date not null,
  product_key  text not null,             -- "A2 저지 헤이밀크 750mL"
  planned      integer not null default 0 check (planned >= 0),
  produced     integer not null default 0 check (produced >= 0),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (prod_date, product_key)
);

create index if not exists production_logs_date_idx
  on public.production_logs (prod_date);

alter table public.production_logs enable row level security;

drop policy if exists "production_select_admin" on public.production_logs;
create policy "production_select_admin" on public.production_logs
  for select using (public.is_admin());

drop policy if exists "production_insert_admin" on public.production_logs;
create policy "production_insert_admin" on public.production_logs
  for insert with check (public.is_admin());

drop policy if exists "production_update_admin" on public.production_logs;
create policy "production_update_admin" on public.production_logs
  for update using (public.is_admin());

drop policy if exists "production_delete_admin" on public.production_logs;
create policy "production_delete_admin" on public.production_logs
  for delete using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 9. 원유 입고 (당일 디투오로 들어온 원유 총량 · 송영신목장 → 디투오)
--    유가공 투입 원유의 공급 측. 당일 1건(총량 L) + 메모.
--    관리자(생산자)만 조회·작성·수정.
-- ───────────────────────────────────────────────────────────
create table if not exists public.milk_intakes (
  intake_date  date primary key,
  liters       numeric not null default 0 check (liters >= 0),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.milk_intakes enable row level security;

drop policy if exists "milk_select_admin" on public.milk_intakes;
create policy "milk_select_admin" on public.milk_intakes
  for select using (public.is_admin());

drop policy if exists "milk_insert_admin" on public.milk_intakes;
create policy "milk_insert_admin" on public.milk_intakes
  for insert with check (public.is_admin());

drop policy if exists "milk_update_admin" on public.milk_intakes;
create policy "milk_update_admin" on public.milk_intakes
  for update using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 10. B2B 거래처 (백화점·카페·도매 등). 추후 B2B 주문·정산으로 확장.
--     관리자만 조회·작성·수정.
-- ───────────────────────────────────────────────────────────
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  memo        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.clients enable row level security;

drop policy if exists "clients_select_admin" on public.clients;
create policy "clients_select_admin" on public.clients
  for select using (public.is_admin());

drop policy if exists "clients_insert_admin" on public.clients;
create policy "clients_insert_admin" on public.clients
  for insert with check (public.is_admin());

drop policy if exists "clients_update_admin" on public.clients;
create policy "clients_update_admin" on public.clients
  for update using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 11. 거래처별 일일 필요량 (B2B 수요). 날짜·거래처·제품별 수량.
--     (demand_date, client_id, product_key) 유니크 → upsert.
--     온라인 수요와 합산해 '총 필요량'을 만든다.
-- ───────────────────────────────────────────────────────────
create table if not exists public.b2b_demand (
  id           uuid primary key default gen_random_uuid(),
  demand_date  date not null,
  client_id    uuid not null references public.clients (id) on delete cascade,
  product_key  text not null,
  qty          integer not null default 0 check (qty >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (demand_date, client_id, product_key)
);

create index if not exists b2b_demand_date_idx
  on public.b2b_demand (demand_date);

alter table public.b2b_demand enable row level security;

drop policy if exists "b2b_select_admin" on public.b2b_demand;
create policy "b2b_select_admin" on public.b2b_demand
  for select using (public.is_admin());

drop policy if exists "b2b_insert_admin" on public.b2b_demand;
create policy "b2b_insert_admin" on public.b2b_demand
  for insert with check (public.is_admin());

drop policy if exists "b2b_update_admin" on public.b2b_demand;
create policy "b2b_update_admin" on public.b2b_demand
  for update using (public.is_admin());

drop policy if exists "b2b_delete_admin" on public.b2b_demand;
create policy "b2b_delete_admin" on public.b2b_demand
  for delete using (public.is_admin());

-- ───────────────────────────────────────────────────────────
-- 12. 받는 사람 주소록 (선물하기). 회원이 자녀·손주 등 받는 분 주소를
--     여러 개 저장해 두고, 정기구독·단품 주문 시 선택해 선물 발송한다.
--     회원 본인만 자신의 주소록을 조회·작성·수정·삭제.
-- ───────────────────────────────────────────────────────────
create table if not exists public.recipients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  phone          text not null,            -- 선물 안내 문자 발송용
  postcode       text,
  address        text not null,
  address_detail text,
  memo           text,                      -- "큰손주", "부모님 댁" 등 메모
  created_at     timestamptz not null default now()
);

create index if not exists recipients_user_idx
  on public.recipients (user_id, created_at desc);

alter table public.recipients enable row level security;

drop policy if exists "recipients_select_own" on public.recipients;
create policy "recipients_select_own" on public.recipients
  for select using (auth.uid() = user_id);

drop policy if exists "recipients_insert_own" on public.recipients;
create policy "recipients_insert_own" on public.recipients
  for insert with check (auth.uid() = user_id);

drop policy if exists "recipients_update_own" on public.recipients;
create policy "recipients_update_own" on public.recipients
  for update using (auth.uid() = user_id);

drop policy if exists "recipients_delete_own" on public.recipients;
create policy "recipients_delete_own" on public.recipients
  for delete using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────
-- 현금영수증 (무통장입금 수기 발행) — 상세 주석은 migration-cash-receipt.sql
-- ───────────────────────────────────────────────────────────
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
