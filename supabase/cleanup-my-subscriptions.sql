-- ─────────────────────────────────────────────────────────────
-- 내 계정(하현제 / hhj3150@hanmail.net)의 테스트 구독·주문만 삭제
--
--   현재 운영 DB에는 자동결제(billing) 테이블이 없고, 구독은
--   orders + subscription_slots 로만 관리된다. 따라서 이 둘만 지우면 된다.
--   order_items·order_returns 는 on delete cascade 로 함께 삭제된다.
--
--   보존: 회원 계정(profiles/auth.users)·다른 회원 데이터는 그대로 둔다.
--   ⚠ 되돌릴 수 없음. STEP 1(미리보기)로 "내 것만" 확인 후 STEP 2 실행.
--   실행: Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

-- ===== STEP 0: 내 계정 uid 확인 (1건 나와야 함) =====
select id as my_uid, email
from auth.users
where email = 'hhj3150@hanmail.net';


-- ===== STEP 1: 삭제 대상 미리보기 (지우지 않음) =====
with me as (select id from auth.users where email = 'hhj3150@hanmail.net')
select
  (select count(*) from public.orders             where user_id = (select id from me)) as orders,
  (select count(*) from public.order_items oi
     join public.orders o on o.id = oi.order_id
    where o.user_id = (select id from me))                                              as order_items,
  (select count(*) from public.subscription_slots where user_id = (select id from me)) as slots;


-- ===== STEP 2: 실제 삭제 (본인 계정 한정, 트랜잭션) =====
-- STEP 1 확인이 끝났으면 아래 블록 전체를 선택해 실행한다.
begin;

-- 1) 구독 슬롯(선착순 정원 점유분) → 정원이 다시 열린다.
delete from public.subscription_slots
 where user_id = (select id from auth.users where email = 'hhj3150@hanmail.net');

-- 2) 주문(단품·구독) → order_items·order_returns 는 cascade 로 함께 삭제.
delete from public.orders
 where user_id = (select id from auth.users where email = 'hhj3150@hanmail.net');

-- 결과가 예상과 맞으면 commit, 아니면 rollback 으로 되돌린다.
commit;
-- rollback;   -- ← 이상하면 commit 대신 이 줄을 실행


-- ===== STEP 3: 확인 (모두 0 이어야 함) =====
with me as (select id from auth.users where email = 'hhj3150@hanmail.net')
select
  (select count(*) from public.orders             where user_id = (select id from me)) as orders,
  (select count(*) from public.subscription_slots where user_id = (select id from me)) as slots;
