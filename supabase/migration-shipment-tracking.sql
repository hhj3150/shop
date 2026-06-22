-- ─────────────────────────────────────────────────────────────
-- 배송 시스템 ① 회차별 배송 레코드(per-cycle shipment record)
--
--   배경/문제:
--     구독은 '주문 1행(orders)'을 회차마다 재출고하는데, 송장·택배사·발송일·
--     배송상태가 전부 orders 의 '단일 컬럼'에만 저장된다. 그래서
--       · 회차가 바뀌면 직전 송장이 덮어써져 carryover·문자누락 버그가 반복되고,
--       · 고객은 지난 회차 배송을 추적할 수 없다(가장 최근 1건만 보임).
--     shipment_log 는 이미 (order_id, ship_date) 회차 단위 행을 가지고 있으나
--     재고 이중차감 방지 용도라 배송정보가 없다.
--
--   해법(이 파일):
--     shipment_log 를 '회차별 배송 레코드'의 권위 테이블로 확장한다.
--       courier / tracking_no / shipped_at / delivered_at 추가.
--     관리자 출고 시 record_shipment_tracking 으로 그 회차 행에 송장을 기록하고,
--     배송완료는 mark_shipment_delivered 로 회차별로 표시한다.
--     고객이 '내 배송 회차 이력'을 볼 수 있도록 select 정책을 본인 주문까지 넓힌다.
--
--   안전/호환:
--     · 기존 stock_ship_out(재고차감 + 행 insert)·과차감 불변식은 건드리지 않는다.
--     · orders 의 단일 컬럼도 당분간 그대로 갱신(레거시 표시·알림 호환). 본 파일은 추가만.
--     · 쓰기는 security definer RPC(is_admin 게이트)로만. UPDATE-only 라 재고우회 불가.
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 회차별 배송정보 컬럼(추가만). shipped_at/delivered_at 은 회차 단위 권위 타임스탬프.
alter table public.shipment_log
  add column if not exists courier      text,
  add column if not exists tracking_no  text,
  add column if not exists shipped_at   timestamptz,
  add column if not exists delivered_at timestamptz;

-- 2) 고객이 '본인 주문의 회차별 배송'을 조회할 수 있게 select 정책 확장(관리자 + 주문 소유자).
--    insert/update 정책은 두지 않는다 → 쓰기는 security definer RPC 로만.
drop policy if exists "shipment_log_select_admin" on public.shipment_log;
drop policy if exists "shipment_log_select_own" on public.shipment_log;
create policy "shipment_log_select_own" on public.shipment_log
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
       where o.id = shipment_log.order_id
         and o.user_id = auth.uid()
    )
  );

-- 3) 회차 송장 기록. 출고(stock_ship_out)로 이미 만들어진 그 회차 행만 갱신한다(UPDATE-only).
--    · stock_ship_out 가 (order_id, ship_date) 행을 먼저 insert → 여기서 송장만 채운다.
--    · shipped_at 은 최초 기록 시각을 보존(coalesce). 빈 송장/택배사는 NULL 로 정규화.
--    · 행이 없으면(아직 미출고) no-op — 재고차감 없이 배송중으로 둔갑하는 것을 막는다.
create or replace function public.record_shipment_tracking(
  p_order_id    uuid,
  p_ship_date   date,
  p_courier     text,
  p_tracking_no text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_order_id is null or p_ship_date is null then
    raise exception '주문·발송일이 필요합니다.';
  end if;

  update public.shipment_log
     set courier     = nullif(trim(coalesce(p_courier, '')), ''),
         tracking_no = nullif(trim(coalesce(p_tracking_no, '')), ''),
         shipped_at  = coalesce(shipped_at, now())
   where order_id = p_order_id
     and ship_date = p_ship_date;
end;
$$;

grant execute on function public.record_shipment_tracking(uuid, date, text, text) to authenticated;

-- 4) 회차 배송완료 표시. 그 회차 행에 delivered_at 기록(이미 있으면 보존).
create or replace function public.mark_shipment_delivered(
  p_order_id  uuid,
  p_ship_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_order_id is null or p_ship_date is null then
    raise exception '주문·발송일이 필요합니다.';
  end if;

  update public.shipment_log
     set delivered_at = coalesce(delivered_at, now())
   where order_id = p_order_id
     and ship_date = p_ship_date;
end;
$$;

grant execute on function public.mark_shipment_delivered(uuid, date) to authenticated;

-- ── 검증(수동, SQL Editor) ──────────────────────────────────────
-- 사전: 관리자 세션. milk-180 을 '월요일' qty 2 로 담은 구독 주문 :oid, 그 주차 월요일 :mon.
--
-- A. 출고 → 회차 행 생성 → 송장 기록:
--   select stock_ship_out(:oid, :mon);                         -- {"status":"shipped",...}
--   select record_shipment_tracking(:oid, :mon, 'logen', '1234567890');
--   select courier, tracking_no, shipped_at from shipment_log where order_id=:oid and ship_date=:mon;
--   → 기대: logen / 1234567890 / (now). shipped_at 채워짐.
--
-- B. 다음 회차(:mon2)는 독립 행 → 직전 송장과 섞이지 않음:
--   select stock_ship_out(:oid, :mon2);
--   select record_shipment_tracking(:oid, :mon2, 'cj', '9999');
--   → shipment_log 에 (oid,:mon)=1234567890, (oid,:mon2)=9999 두 행이 각각 보존.
--
-- C. 미출고 회차 기록 시도 → no-op(재고우회 불가):
--   select record_shipment_tracking(:oid, :mon3, 'cj', '7777');  -- 그 회차 미출고
--   select count(*) from shipment_log where order_id=:oid and ship_date=:mon3;  -- 0
--
-- D. 배송완료:
--   select mark_shipment_delivered(:oid, :mon);
--   select delivered_at from shipment_log where order_id=:oid and ship_date=:mon;  -- (now)
--
-- E. 고객 조회 정책(본인 주문):
--   주문 소유자 세션에서 select * from shipment_log where order_id=:oid; → 행이 보임.
--   타인 세션 → 0행.
