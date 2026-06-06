-- ╔══════════════════════════════════════════════════════════════╗
-- ║ ⚠ 실행 금지(비활성화) — 실데이터(실제 고객) 운영 중 (2026-06-06~)   ║
-- ║   본인(하현제/hhj3150) 계정엔 구독·주문이 없음(이미 0 확인 완료).   ║
-- ║   더 지울 것이 없으므로 삭제문은 주석 처리해 두었다.               ║
-- ║   다시 필요할 때만, 대상 계정이 본인 테스트임을 확인 후 사용한다.    ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 내 계정(hhj3150@hanmail.net)의 테스트 구독·주문만 삭제하는 스크립트(현재 비활성화).
-- 구독은 orders + subscription_slots 로 관리됨(order_items·order_returns 는 cascade).

-- ── STEP 0: 내 계정 uid 확인 (읽기 전용) ──
select id as my_uid, email
from auth.users
where email = 'hhj3150@hanmail.net';

-- ── STEP 1: 삭제 대상 미리보기 (읽기 전용) ──
with me as (select id from auth.users where email = 'hhj3150@hanmail.net')
select
  (select count(*) from public.orders             where user_id = (select id from me)) as orders,
  (select count(*) from public.order_items oi
     join public.orders o on o.id = oi.order_id
    where o.user_id = (select id from me))                                              as order_items,
  (select count(*) from public.subscription_slots where user_id = (select id from me)) as slots;

-- ── STEP 2: 실제 삭제 (비활성화 — 실행 금지) ──
-- ⚠ 아래는 주석 처리되어 있다. 정말 필요할 때만, 대상이 본인 테스트 계정임을
--    STEP 1 미리보기로 확인한 뒤 주석을 해제해 실행한다.
-- begin;
-- delete from public.subscription_slots
--  where user_id = (select id from auth.users where email = 'hhj3150@hanmail.net');
-- delete from public.orders
--  where user_id = (select id from auth.users where email = 'hhj3150@hanmail.net');
-- commit;

-- ── STEP 3: 확인 (읽기 전용) ──
with me as (select id from auth.users where email = 'hhj3150@hanmail.net')
select
  (select count(*) from public.orders             where user_id = (select id from me)) as orders,
  (select count(*) from public.subscription_slots where user_id = (select id from me)) as slots;
