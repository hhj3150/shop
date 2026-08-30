-- 자동문자·데이터 일관성 정기 점검 (한 번에 실행 → 한 표로 결과)
--
--  왜 있나: 2026-08-28 '지난 배송' 문자 121건 오발송 뒤, 같은 종류의 사고를 사람이
--    눈으로 찾지 않아도 드러나게 하려고 만들었다. 전부 읽기 전용(SELECT)이다.
--
--  쓰는 법: Supabase SQL Editor 에 통째로 붙여넣고 실행.
--    · 건수 0 = 정상. 0이 아니면 그 항목의 '자세히 보기' 쿼리를 아래에서 찾아 돌린다.
--    · 주 1회(예: 월요일 아침)면 충분하다.

with
-- 점검 대상 기간: 최근 90일
params as (select (now() - interval '90 days') as since),

-- ① 주문접수·입금안내 문자를 못 받은 주문 (취소 제외)
a as (
  select count(*) n from public.orders o, params p
   where o.created_at >= p.since
     and coalesce(o.status,'') not in ('취소','cancelled')
     and not exists (
       select 1 from public.sms_log s
        where s.order_id = o.id
          and s.kind in ('order_received','gift_subscription','gift_once','renewal_guide')
          and s.ok
     )
),
-- ② 입금이 확인됐는데 입금확인 문자를 못 받은 주문
b as (
  select count(*) n from public.orders o, params p
   where o.created_at >= p.since
     and coalesce(o.status,'') in ('입금확인','배송중','배송완료')
     and not exists (
       select 1 from public.sms_log s
        where s.order_id = o.id and s.kind = 'payment_confirmed' and s.ok
     )
),
-- ③ 출고했는데 발송안내 문자가 없는 건 (출고 전후 3일 내 발송 기준)
c as (
  select count(*) n from public.shipment_log sl, params p
   where sl.shipped_at >= p.since
     and not exists (
       select 1 from public.sms_log s
        where s.order_id = sl.order_id and s.kind = 'shipped' and s.ok
          and s.sent_at between sl.shipped_at - interval '1 day' and sl.shipped_at + interval '2 day'
     )
),
-- ④ 실패로 기록된 발송
d as (select count(*) n from public.sms_log s, params p where s.sent_at >= p.since and s.ok is not true),
-- ⑤ '지난 배송' 문자 — 출고 7일이 지난 뒤 나간 발송·배송완료 안내
--    (2026-08-28 사고와 같은 유형. 서버 차단이 살아 있으면 0이어야 한다.)
e as (
  select count(*) n
    from public.sms_log s
    join public.shipment_log sl on sl.order_id = s.order_id
       , params p
   where s.sent_at >= p.since
     and s.kind in ('shipped','delivered') and s.ok
     and sl.shipped_at is not null
     and (s.sent_at at time zone 'Asia/Seoul')::date
         - (sl.shipped_at at time zone 'Asia/Seoul')::date between 8 and 400
     and not exists (  -- 더 최근 출고가 있으면 그 건에 대한 정상 안내다
       select 1 from public.shipment_log s2
        where s2.order_id = s.order_id and s2.shipped_at > sl.shipped_at
          and s2.shipped_at <= s.sent_at
     )
),
-- ⑥ 예정일이 지났는데 출고 기록이 없는 구독 회차 (방문수령·취소 제외)
--    화면(고객 마이페이지)은 '배송됨'으로 세는데 실제 기록이 없는 상태 = 불일치.
chain as (
  select s.id slot_id, o.id order_id from public.subscription_slots s
    join public.orders o on o.id = s.order_id where s.status = '활성'
  union
  select s.id, r.id from public.subscription_slots s
    join public.orders r on r.renews_slot_id = s.id
   where s.status = '활성' and r.status <> '취소'
),
actual as (
  select distinct c.slot_id, sl.ship_date from chain c
    join public.shipment_log sl on sl.order_id = c.order_id
),
planned as (
  select s.id slot_id, d.ship_date
    from public.subscription_slots s
    join public.orders o on o.id = s.order_id,
         lateral public.sub_delivery_dates(
           s.started_at, s.first_ship_date,
           greatest(o.block_weeks + s.extended_weeks, 1), s.paused_days
         ) d
   where s.status = '활성' and s.started_at is not null
     and o.delivery_method <> '방문수령' and o.status <> '취소'
),
f as (
  select count(*) n
    from planned p
   where p.ship_date <= (now() at time zone 'Asia/Seoul')::date
     and p.ship_date >= (now() at time zone 'Asia/Seoul')::date - 90
     and not exists (select 1 from actual a where a.slot_id = p.slot_id and a.ship_date = p.ship_date)
),
-- ⑦ 주문은 취소인데 구독 슬롯이 아직 '활성'
g as (
  select count(*) n from public.subscription_slots s
    join public.orders o on o.id = s.order_id
   where s.status = '활성' and o.status = '취소'
),
-- ⑧ 구독 발송인데 회차 표기가 빠진 문자 (연장주문 회차 누락 유형)
h as (
  select count(*) n from public.sms_log s
    join public.orders o on o.id = s.order_id, params p
   where s.sent_at >= p.since and s.kind = 'shipped' and s.ok
     and o.order_type = '구독'
     and s.body !~ '회 중 '
)
select * from (
  values
    ('① 주문접수·입금안내 문자 없음', (select n from a)),
    ('② 입금확인 문자 없음',          (select n from b)),
    ('③ 출고했는데 발송안내 없음',     (select n from c)),
    ('④ 발송 실패 기록',              (select n from d)),
    ('⑤ 지난 배송 문자(출고 8일 이상)', (select n from e)),
    ('⑥ 예정일 지났는데 출고기록 없음', (select n from f)),
    ('⑦ 주문 취소인데 슬롯 활성',      (select n from g)),
    ('⑧ 구독 발송문자에 회차 표기 없음', (select n from h))
) as t(점검항목, 건수);


-- ─────────────────────────────────────────────────────────────
-- 자세히 보기 (필요할 때 해당 블록만 실행)
-- ─────────────────────────────────────────────────────────────

-- ① 주문접수 문자 없는 주문
-- select o.order_no, o.created_at::date, o.status, (o.user_id is null) as 비회원, o.order_type
--   from public.orders o
--  where o.created_at >= now() - interval '90 days'
--    and coalesce(o.status,'') not in ('취소','cancelled')
--    and not exists (select 1 from public.sms_log s where s.order_id=o.id
--                     and s.kind in ('order_received','gift_subscription','gift_once','renewal_guide') and s.ok)
--  order by o.created_at desc;

-- ⑥ 예정일이 지났는데 출고 기록이 없는 회차
-- (위 with 절 chain·actual·planned 를 그대로 앞에 붙이고 아래를 실행)
-- select p.slot_id, p.ship_date
--   from planned p
--  where p.ship_date <= (now() at time zone 'Asia/Seoul')::date
--    and not exists (select 1 from actual a where a.slot_id=p.slot_id and a.ship_date=p.ship_date)
--  order by p.ship_date desc, p.slot_id;

-- ⑧ 회차 표기가 빠진 구독 발송 문자
-- select o.order_no, o.renews_slot_id, (s.sent_at at time zone 'Asia/Seoul') as 발송시각, s.body
--   from public.sms_log s join public.orders o on o.id = s.order_id
--  where s.kind='shipped' and s.ok and o.order_type='구독' and s.body !~ '회 중 '
--  order by s.sent_at desc;
