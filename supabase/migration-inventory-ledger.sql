-- ─────────────────────────────────────────────────────────────
-- 물류 ERP ① 실시간 재고 원장(자동차감)
--   product_catalog.stock(현재고 권위값)은 유지하고, 그 변동을 불변 원장에 기록한다.
--   쓰기는 security definer RPC 로만(is_admin 게이트 + for update 원자성).
--   배송 출고는 shipment_log unique 로 주차(발송일)별 1회만 차감.
--
--   보존: _create_once_order_core / create_subscription_order 의 stock=0 품절 차단은
--         건드리지 않는다(본 파일은 신규 추가만, 두 RPC 를 재정의하지 않음).
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 안전재고(경보 기준). NULL = 경보 안 함. stock 은 현재고 권위값으로 유지.
alter table public.product_catalog
  add column if not exists safety_stock integer
    check (safety_stock is null or safety_stock >= 0);

-- 2) 불변 원장: 입고/출고/조정/폐기 거래.
create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  product_id   text not null references public.product_catalog (id),
  delta        integer not null,                   -- +입고/조정, −출고/폐기
  kind         text not null check (kind in ('입고','출고','조정','폐기')),
  ref_order_id uuid references public.orders (id), -- 출고 시 연결 주문(감사)
  note         text,
  created_at   timestamptz not null default now(),
  created_by   uuid                                -- auth.uid()
);
create index if not exists stock_movements_product_idx
  on public.stock_movements (product_id, created_at desc);

alter table public.stock_movements enable row level security;
-- 조회는 관리자만. 쓰기 정책은 두지 않는다(RPC=security definer 만 INSERT).
drop policy if exists "stock_movements_select_admin" on public.stock_movements;
create policy "stock_movements_select_admin" on public.stock_movements
  for select using (public.is_admin());

-- 3) 이중차감 방지 로그. 같은 주문·같은 발송일은 1회만 차감.
create table if not exists public.shipment_log (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id),
  ship_date   date not null,
  deducted_at timestamptz not null default now(),
  unique (order_id, ship_date)
);
alter table public.shipment_log enable row level security;
drop policy if exists "shipment_log_select_admin" on public.shipment_log;
create policy "shipment_log_select_admin" on public.shipment_log
  for select using (public.is_admin());

-- 4) 관리자 수동 거래(입고/조정/폐기). movement insert + stock 원자 증감(for update).
--    음수 재고 차단(0 미만이면 예외). 무제한(stock IS NULL) 품목은 조정 불가(예외).
create or replace function public.stock_adjust(
  p_product_id text,
  p_delta      integer,
  p_kind       text,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
  v_new   int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_kind not in ('입고','조정','폐기') then
    raise exception '거래 유형이 올바르지 않습니다: %', p_kind;
  end if;
  if p_delta = 0 then raise exception '변동 수량이 0 입니다.'; end if;

  -- 현재고 행잠금(동시 차감 직렬화).
  select stock into v_stock from public.product_catalog
    where id = p_product_id for update;
  if not found then raise exception '존재하지 않는 제품입니다: %', p_product_id; end if;
  if v_stock is null then
    raise exception '무제한(재고 미관리) 품목은 조정할 수 없습니다. 먼저 현재고를 설정하세요.';
  end if;

  v_new := v_stock + p_delta;
  if v_new < 0 then
    raise exception '재고 부족: 현재고 % 에서 % 를 적용할 수 없습니다.', v_stock, p_delta;
  end if;

  update public.product_catalog set stock = v_new where id = p_product_id;
  insert into public.stock_movements (product_id, delta, kind, note, created_by)
    values (p_product_id, p_delta, p_kind, nullif(trim(coalesce(p_note,'')),''), auth.uid());

  return jsonb_build_object('product_id', p_product_id, 'stock', v_new);
end;
$$;

grant execute on function public.stock_adjust(text, integer, text, text) to authenticated;

-- 5) 배송 출고 확정 시 자동 차감. shipment_log unique 로 주차(발송일)별 1회만.
--    이미 출고된 주문·발송일이면 '이미 출고됨' 반환(차감 안 함, 이중차감 방지).
--    그 발송일에 해당하는 품목만 합산 → '출고' movement + stock 차감. stock NULL 품목은 건너뜀.
--
--    [불변식 — 과차감 방지의 핵심]
--    · order_items.qty 는 '회당(1발송) 수량'이다(create_subscription_order 가 v_qty 를 그대로 저장,
--      ×주차 아님). 따라서 발송일마다 1회 차감하면 정확히 그 주차 1회분만 빠진다.
--    · 구독이 여러 요일에 품목을 둘 수 있으므로, p_ship_date 의 요일과 일치하는 품목만 차감한다
--      (월요일 출고 → 월요일 품목만). 단품은 delivery_day=null → 그 발송일에 1회 전량 차감.
--    · 같은 (주문, 발송일) 재호출은 shipment_log unique 충돌로 1회만 → 주차별 정확히 1회.
create or replace function public.stock_ship_out(
  p_order_id  uuid,
  p_ship_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_dow      int := extract(dow from p_ship_date)::int;  -- 0=일 … 6=토
  v_day      text;
  v_rec      record;
  v_stock    int;
  v_new      int;
  v_deducted int := 0;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_order_id is null or p_ship_date is null then
    raise exception '주문·발송일이 필요합니다.';
  end if;

  -- 발송일의 요일키(구독 품목 필터용). 주말이면 null → 구독 품목은 매칭 안 됨(단품만).
  v_day := case v_dow
             when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
             when 4 then 'thu' when 5 then 'fri' else null end;

  -- 이중차감 방지: 같은 주문·발송일 1회만. 충돌이면 아무 행도 안 들어옴.
  insert into public.shipment_log (order_id, ship_date)
    values (p_order_id, p_ship_date)
    on conflict (order_id, ship_date) do nothing;
  get diagnostics v_inserted = row_count;  -- 0 = 충돌(이미 출고됨)
  if v_inserted = 0 then
    return jsonb_build_object('status', 'already', 'deducted', 0);
  end if;

  -- 그 발송일 해당 품목만 합산 후 차감(단품=delivery_day null, 구독=요일 일치).
  --   order by product_id: stock_adjust 와 동일한 잠금 순서 → 교착(deadlock) 방지.
  for v_rec in
    select product_id, sum(qty)::int as qty
      from public.order_items
     where order_id = p_order_id
       and (delivery_day is null or delivery_day = v_day)
     group by product_id
     order by product_id
  loop
    select stock into v_stock from public.product_catalog
      where id = v_rec.product_id for update;
    if not found then continue; end if;          -- 카탈로그에 없는 제품은 건너뜀
    if v_stock is null then continue; end if;     -- 무제한 품목은 차감 안 함

    v_new := v_stock - v_rec.qty;
    if v_new < 0 then
      raise exception '재고 부족: % 현재고 %, 출고 % 불가', v_rec.product_id, v_stock, v_rec.qty;
    end if;
    update public.product_catalog set stock = v_new where id = v_rec.product_id;
    insert into public.stock_movements (product_id, delta, kind, ref_order_id, note, created_by)
      values (v_rec.product_id, -v_rec.qty, '출고', p_order_id,
              to_char(p_ship_date, 'YYYY-MM-DD') || ' 배송 출고', auth.uid());
    v_deducted := v_deducted + 1;
  end loop;

  return jsonb_build_object('status', 'shipped', 'deducted', v_deducted);
end;
$$;

grant execute on function public.stock_ship_out(uuid, date) to authenticated;

-- ── 검증(수동, SQL Editor 에서 단계별 실행) ──────────────────────
-- 사전: 관리자 세션에서 실행(is_admin()=true). 테스트 제품 1개 준비.
--   update product_catalog set stock = 10, safety_stock = 3 where id = 'milk-180';
--
-- A. 음수재고 차단(레드-그린):
--   select stock_adjust('milk-180', -100, '폐기', '음수 테스트');
--   → 기대: ERROR '재고 부족 …'. (그린: 차단됨)
--
-- B. 정상 입고:
--   select stock_adjust('milk-180', 50, '입고', '일배치 생산');
--   → 기대: {"stock": 60}. select stock from product_catalog where id='milk-180'; → 60.
--
-- C. 출고 1회 차감:
--   (milk-180 을 '월요일' 배송으로 qty 2 담은 주문 1건의 id 를 :oid, 그 주차 월요일을 :mon 으로.)
--   select stock_ship_out(:oid, :mon);
--   → 기대: {"status":"shipped","deducted":>=1}. stock 이 qty(2) 만큼 감소.
--
-- D. 이중 출고 → 차감 1회만(레드-그린 핵심):
--   select stock_ship_out(:oid, :mon);  -- 같은 주문·같은 발송일 재호출
--   → 기대: {"status":"already","deducted":0}. stock 변화 없음.
--   select count(*) from stock_movements where ref_order_id = :oid;  -- 출고 movement 1세트만.
--
-- E. 동시성(for update) — 두 세션에서 동시에:
--   세션1: begin; select stock_adjust('milk-180', -30, '조정', 's1');  -- 커밋 보류
--   세션2: select stock_adjust('milk-180', -40, '조정', 's2');         -- 블록되어 대기
--   세션1: commit;  → 세션2 가 갱신된 현재고 기준으로 진행, 음수면 차단.
--   → for update 가 없으면 둘 다 같은 현재고를 읽어 과차감. 있으면 직렬화됨.
--
-- F. 무제한 품목 스킵:
--   update product_catalog set stock = null where id = 'yogurt-500';
--   yogurt-500 포함 주문 출고 → 해당 품목 movement 없음·stock 그대로 null.
--
-- G. 요일 스코프(과차감 방지): 월요일 발송일로 호출 시, 화·수·목·금 품목은 차감되지 않음.
--   → 단품(delivery_day null)은 어떤 발송일이든 1회 전량 차감.
--
-- 정리(테스트 데이터 롤백):
--   delete from shipment_log where order_id = :oid;
--   delete from stock_movements where ref_order_id = :oid or note like '%테스트%';
