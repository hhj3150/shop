-- 운영 무결성 점검 — 손님 화면과 관리자 화면이 갈리는 지점을 한 번에 훑는다.
--
--   쓰는 법: Supabase SQL Editor 에 전체를 붙여 넣고 실행한다. 모든 n 이 0 이어야 정상이다.
--   0 이 아닌 항목은 아래 '상세' 쿼리로 대상을 뽑아 처리한다.
--   주 1회(발송 주간 시작 전)와 배포 직후에 돌리는 것을 권장한다.
--
--   ⚠ 금액 모델: 구독은 total_amount = (회당 품목합) × block_weeks + shipping_fee 다.
--     단품만 품목합 + 배송비. 이 차이를 모르고 비교하면 정상 주문이 전부 이상으로 잡힌다.

select 'A. 주문 총액 ≠ 산식(구독=회당×회차+배송비, 단품=품목합+배송비)' as chk, count(*) as n
  from orders o
 where o.status <> '취소'
   and exists (select 1 from order_items i where i.order_id = o.id)
   and o.total_amount <>
       (select coalesce(sum(i.unit_price * i.qty), 0) from order_items i where i.order_id = o.id)
       * (case when o.order_type = '구독' then greatest(coalesce(o.block_weeks, 1), 1) else 1 end)
       + coalesce(o.shipping_fee, 0)

union all select 'B. 입금확인류인데 결제시각(paid_at) 없음', count(*)
  from orders where status in ('입금확인','배송준비','배송중','배송완료') and paid_at is null

union all select 'C. 활성 슬롯인데 시작일(started_at) 없음', count(*)
  from subscription_slots where status = '활성' and started_at is null

-- 손님 화면에는 구독이 살아 있는데 배송은 나가지 않는다. 요일 정원도 계속 점유한다.
--   → admin_cancel_order(주문id) 로 정리(관리자 '데이터 점검'의 [좌석 해지] 버튼과 같은 처리).
union all select 'D. 주문은 취소인데 구독 좌석이 살아 있음', count(*)
  from subscription_slots s join orders o on o.id = s.order_id
 where o.status = '취소' and s.status <> '해지'

union all select 'E. 슬롯 요일에 해당하는 주문 품목이 없음', count(*)
  from subscription_slots s join orders o on o.id = s.order_id
 where o.order_type = '구독' and o.status <> '취소'
   and not exists (select 1 from order_items i where i.order_id = o.id and i.delivery_day = s.delivery_day)

union all select 'F. 배송완료인데 송장번호 없음(택배분)', count(*)
  from orders where status = '배송완료' and coalesce(tracking_no,'') = ''
    and coalesce(delivery_method,'택배') <> '방문수령'

union all select 'G. 같은 주문·같은 발송일 출고 이력 중복', count(*)
  from (select order_id, ship_date from shipment_log group by 1,2 having count(*) > 1) t

union all select 'H. 품목 0건 주문(취소 제외)', count(*)
  from orders o where o.status <> '취소'
   and not exists (select 1 from order_items i where i.order_id = o.id)

union all select 'I. 요일 정원(100) 초과', count(*)
  from (select delivery_day from subscription_slots where status in ('신청','활성')
         group by 1 having count(*) > 100) t

union all select 'J. 구독 주문인데 슬롯이 없음(취소 제외)', count(*)
  from orders o where o.order_type = '구독' and o.status <> '취소' and o.renews_slot_id is null
   and not exists (select 1 from subscription_slots s where s.order_id = o.id)

union all select 'K. 단품 확정류인데 발송예정일 없음', count(*)
  from orders where order_type = '단품' and status in ('입금확인','배송준비','배송중') and ship_date is null

-- 좌석 카운트 뷰가 실제 슬롯 수와 다르면 모집 현황이 거짓말을 한다.
union all select 'L. 좌석 카운트 뷰 ≠ 실제 슬롯 수', count(*)
  from subscription_day_count v
  join (select delivery_day, count(*) c from subscription_slots
         where status in ('신청','활성') group by 1) t on t.delivery_day = v.delivery_day
 where t.c <> v.taken

union all select 'M. 배송중인데 출고 이력 없음', count(*)
  from orders o where o.status = '배송중'
   and not exists (select 1 from shipment_log sl where sl.order_id = o.id)

-- 재고: 2026-09 현재 전 품목 product_catalog.stock = null(무제한)로 운영한다. 매주 생산해
--   보내는 신선식품이라 수량 재고를 잡지 않는다 → stock_ship_out 이 차감을 건너뛰고
--   stock_movements 도 비어 있는 것이 정상이다. 재고를 켜는 날 이 점검이 의미를 갖는다.
union all select 'N. 재고 합계가 음수인 제품(재고 미사용 시 항상 0)', count(*)
  from (select product_id from stock_movements group by 1 having sum(delta) < 0) t

union all select 'O. 확정 연장주문인데 슬롯이 해지됨', count(*)
  from orders r join subscription_slots s on s.id = r.renews_slot_id
 where r.renews_slot_id is not null
   and r.status in ('입금확인','배송준비','배송중','배송완료') and s.status = '해지'

-- 총 회차의 두 계산이 갈리면, 손님 화면(회차·환불 미리보기)과 서버 환불액·배송 명단이 달라진다.
--   앱은 모두 '확정 블록 체인' 기준으로 통일돼 있다. extended_weeks 는 옛 잔재 컬럼이다.
union all select 'P. slots.extended_weeks ≠ 확정 연장주문 회차 합', count(*)
  from subscription_slots s
 where coalesce(s.extended_weeks, 0) <>
       coalesce((select sum(coalesce(r.block_weeks, 0)) from orders r
                  where r.renews_slot_id = s.id
                    and r.status in ('입금확인','배송준비','배송중','배송완료')), 0)

-- 주문 생성 '코어' RPC 가 손님 키(anon/authenticated)로 직접 호출 가능한가.
--   _create_once_order_core 는 첫 인자로 user_id 를 그대로 받는다. 손님이 직접 부를 수 있으면
--   남의 uuid 를 넣어 타인 명의 주문을 만들 수 있다. 반드시 래퍼(create_once_order /
--   create_guest_once_order)를 통해서만 부르게 하고, 코어는 revoke all from public 상태여야 한다.
--   ★ 옛 시그니처가 오버로드로 남아 있어도 여기 잡힌다(인자 수 무관).
union all select 'Q. 주문 코어 RPC 가 손님 키로 호출 가능', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = '_create_once_order_core'
   and (p.proacl is null                                    -- null = PUBLIC 실행가능(기본값)
        or array_to_string(p.proacl, ',') ~ '(^|,)(=|anon=|authenticated=)')

-- 주문·연장 RPC 에서 서버 권위 가드가 빠졌는가 — 마이그레이션이 옛 본문으로 덮어쓰면 조용히 사라진다.
--   재고 0 차단 / 정가 기준 최소주문(24,000원) / 멱등키. 셋 다 '돈이 어긋나는' 가드다.
--   ※ request_renewal 은 멱등키 인자가 없고 '입금대기 연장 중복 거절'로 대신 막는다 → 멱등키 제외.
union all select 'R. 주문 RPC 에 서버 권위 가드 누락(재고·정가최소·멱등키)', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
       lateral pg_get_functiondef(p.oid) as d(src)
 where n.nspname = 'public'
   and p.proname in ('_create_once_order_core','create_once_order','create_subscription_order')
   and (position('stock'  in d.src) = 0        -- 재고 0(품절) 차단
     or position('24000'  in d.src) = 0        -- 정가 기준 최소주문
     or position('25000'  in d.src) > 0        -- 옛 할인가 기준 25,000원 잔존
     or position('idempotency' in d.src) = 0)  -- 멱등키
order by 1;


-- ── 상세 ───────────────────────────────────────────────────────────────────
-- D. 취소 주문의 살아 있는 좌석 (→ select public.admin_cancel_order('<주문id>'::uuid, '좌석 정리');)
--   select s.id slot_id, s.status, s.delivery_day, o.order_no, o.ship_name, o.id order_id
--     from subscription_slots s join orders o on o.id = s.order_id
--    where o.status = '취소' and s.status <> '해지';

-- 출고 기록이 실제 발송을 못 따라가는 구독 — 과배송 방어선(배송 시트의 '발송금지')과
--   손님 마이페이지의 '배송 현황'이 모두 이 기록을 센다. 기록이 비면 방어선이 작동하지 않는다.
--   (관리자 '데이터 점검'의 같은 항목과 동일 판정: 누락 2회 이상)
--   ⚠ 진행 중인 정지는 '놓친 회차 × 7일'로 환산한다(missed_delivery_weeks) — 경과 일수를 그대로
--     더하면 정지 중인 슬롯의 model_delivered 가 틀어져 멀쩡한 구독이 누락으로 잡힌다.
--     lib/subscription-schedule.ts·cancel_subscription 과 같은 규칙이어야 한다.
--   ⚠ 방문수령·취소 주문은 제외한다. 방문수령은 택배 출고가 없어 기록이 원래 0건이고,
--     취소 주문의 살아 있는 좌석은 D 항목이 따로 잡는다. 안 거르면 멀쩡한 건이 섞여
--     숫자가 부풀고, 진짜 누락이 그 안에 묻힌다(2026-09-24 실측: 27건 → 23건).
--   with chain as (
--     select s.id slot_id, s.started_at, s.first_ship_date, s.paused, s.paused_at, s.paused_days,
--            s.delivery_day, s.order_id, o.order_no, o.ship_name,
--            (coalesce(o.block_weeks,0) + coalesce((select sum(coalesce(r.block_weeks,0)) from orders r
--               where r.renews_slot_id = s.id
--                 and r.status in ('입금확인','배송준비','배송중','배송완료')),0))::int as total_weeks
--       from subscription_slots s join orders o on o.id = s.order_id
--      where s.status = '활성' and s.started_at is not null
--        and o.delivery_method <> '방문수령'   -- 택배 출고만 기록이 남는다(방문수령은 원래 0건)
--        and o.status <> '취소')               -- 취소 주문의 살아 있는 좌석은 D 항목이 잡는다
--   select slot_id, order_no, ship_name, delivery_day, total_weeks, model_delivered, actual_shipped,
--          model_delivered - actual_shipped as gap
--     from (select c.*,
--            (select count(*) from sub_delivery_dates(c.started_at, c.first_ship_date, c.total_weeks,
--                (c.paused_days + case when c.paused and c.paused_at is not null
--                                      then missed_delivery_weeks(c.started_at, c.first_ship_date,
--                                             c.total_weeks, c.paused_days,
--                                             c.paused_at, current_date + 1) * 7
--                                      else 0 end)::int) d
--              where d.ship_date <= current_date)::int as model_delivered,
--            (select count(*) from shipment_log sl
--               where sl.order_id = c.order_id
--                  or sl.order_id in (select r.id from orders r where r.renews_slot_id = c.slot_id))::int
--              as actual_shipped
--            from chain c) m
--    where model_delivered - actual_shipped >= 2
--    order by gap desc, slot_id;
