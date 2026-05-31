-- 테스트 데이터 정리: 지금까지의 모든 주문/구독 신청을 삭제한다.
--
-- 적용 방법: Supabase SQL Editor에 붙여넣고 실행.
-- 보존 대상: 회원 계정(profiles / auth.users)은 그대로 둔다.
-- 삭제 대상: 모든 주문(단품·구독), 주문 품목, 구독 슬롯(선착순 정원 점유분).
-- 주의: 되돌릴 수 없는 작업이다. 정식 오픈 전 테스트 데이터 정리 용도로만 사용.

begin;

-- 1) 구독 슬롯 전부 삭제 → 선착순 정원이 다시 0명으로 열린다.
--    (orders 를 먼저 지워도 order_id 는 on delete set null 이라 슬롯은 남으므로 별도 삭제)
delete from public.subscription_slots;

-- 2) 주문 삭제. order_items 는 on delete cascade 로 함께 삭제된다.
delete from public.orders;

commit;

-- 3) 확인: 모두 0 이어야 한다.
select
  (select count(*) from public.orders)             as orders,
  (select count(*) from public.order_items)        as order_items,
  (select count(*) from public.subscription_slots) as subscription_slots;

-- (선택) 선물 주소록도 테스트로 넣었다면 함께 비우려면 아래 주석을 해제해 실행.
-- delete from public.recipients;
