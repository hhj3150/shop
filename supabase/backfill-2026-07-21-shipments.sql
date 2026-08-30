-- 2026-07-21(화) 출고 기록 백필
--
--  무슨 일이 있었나: 화요일 구독 10건의 7/21 회차가 shipment_log 에 한 건도 없다.
--    같은 슬롯들이 7/14 와 7/28 에는 정상 출고돼 있어 그 주만 기록이 비어 있다.
--    사장님 확인: 물건은 나갔고 기록만 누락됐다.
--
--  이 파일이 하는 일: 그 회차의 출고 기록만 채운다.
--    · 문자는 나가지 않는다 — 문자는 앱 화면 조작으로만 나가고, /api/notify 의
--      '지난 배송 차단'(출고 7일 초과 금지)이 이 과거 건을 한 번 더 막는다.
--    · 재고는 건드리지 않는다.
--
--  ★ 재고 주의(꼭 읽을 것)
--    shipment_log 는 '이 주문·이 발송일은 재고를 이미 뺐다'는 표시도 겸한다(stock_ship_out).
--    7/21 에 재고 차감이 안 된 상태이므로, 이 백필을 넣으면 그 10건분 재고는 앞으로도
--    자동으로 빠지지 않는다. 실물은 나갔으니 재고 수치가 그만큼 많게 남는다.
--    → 백필 후 관리자 재고 화면에서 그 10건분을 '조정'으로 한 번 빼주면 장부가 맞는다.
--      (그날 이미 손으로 빼두었다면 아무것도 하지 않아도 된다.)
--
--  채워지는 건 '직전 회차 출고 기록이 있는' 슬롯뿐이다(어느 주문 행에 붙일지 알 수 있으므로).
--    7/21 이 첫 회차였던 구독(SY20260719-5218·SY20260719-5685)과 출고 기록이 아예 없는
--    SY20260605-8986 은 자동으로 못 채운다 — 미리보기 목록에서 빠지니 따로 확인해 주세요.
--
--  실행 순서: ① 미리보기로 대상 목록을 눈으로 확인 → ② INSERT 실행.
--  두 번 실행해도 안전하다(unique(order_id, ship_date) + on conflict do nothing).

-- ─────────────────────────────────────────────
-- ① 미리보기 — 무엇이 채워질지 먼저 본다
-- ─────────────────────────────────────────────
with chain as (
  select s.id as slot_id, o.id as order_id
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id
   where s.status = '활성'
  union
  select s.id, r.id
    from public.subscription_slots s
    join public.orders r on r.renews_slot_id = s.id
   where s.status = '활성' and r.status <> '취소'
),
planned as (
  select distinct s.id as slot_id
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id,
         lateral public.sub_delivery_dates(
           s.started_at, s.first_ship_date,
           greatest(o.block_weeks + s.extended_weeks, 1), s.paused_days
         ) d
   where s.status = '활성'
     and s.started_at is not null
     and o.delivery_method <> '방문수령'
     and o.status <> '취소'
     and d.ship_date = date '2026-07-21'
),
-- 그 슬롯이 직전에 실제로 출고한 주문 행 = 이번에 기록을 붙일 행
-- (원주문·연장주문 중 그때 살아 있던 쪽).
target as (
  select p.slot_id,
         (select sl.order_id
            from public.shipment_log sl
            join chain c2 on c2.order_id = sl.order_id and c2.slot_id = p.slot_id
           where sl.ship_date < date '2026-07-21'
           order by sl.ship_date desc
           limit 1) as order_id
    from planned p
   where not exists (
     select 1
       from public.shipment_log sl2
       join chain c3 on c3.order_id = sl2.order_id and c3.slot_id = p.slot_id
      where sl2.ship_date = date '2026-07-21'
   )
)
select t.slot_id, o.order_no, o.ship_name, o.order_type
  from target t
  join public.orders o on o.id = t.order_id
 order by o.ship_name;

-- ─────────────────────────────────────────────
-- ② 실제 백필 — 위 목록이 맞으면 이 블록을 실행
-- ─────────────────────────────────────────────
with chain as (
  select s.id as slot_id, o.id as order_id
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id
   where s.status = '활성'
  union
  select s.id, r.id
    from public.subscription_slots s
    join public.orders r on r.renews_slot_id = s.id
   where s.status = '활성' and r.status <> '취소'
),
planned as (
  select distinct s.id as slot_id
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id,
         lateral public.sub_delivery_dates(
           s.started_at, s.first_ship_date,
           greatest(o.block_weeks + s.extended_weeks, 1), s.paused_days
         ) d
   where s.status = '활성'
     and s.started_at is not null
     and o.delivery_method <> '방문수령'
     and o.status <> '취소'
     and d.ship_date = date '2026-07-21'
),
target as (
  select p.slot_id,
         (select sl.order_id
            from public.shipment_log sl
            join chain c2 on c2.order_id = sl.order_id and c2.slot_id = p.slot_id
           where sl.ship_date < date '2026-07-21'
           order by sl.ship_date desc
           limit 1) as order_id
    from planned p
   where not exists (
     select 1
       from public.shipment_log sl2
       join chain c3 on c3.order_id = sl2.order_id and c3.slot_id = p.slot_id
      where sl2.ship_date = date '2026-07-21'
   )
)
insert into public.shipment_log (order_id, ship_date, shipped_at)
select t.order_id, date '2026-07-21', timestamptz '2026-07-21 09:00:00+09'
  from target t
 where t.order_id is not null
on conflict (order_id, ship_date) do nothing;
