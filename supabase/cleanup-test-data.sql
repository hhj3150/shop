-- ╔══════════════════════════════════════════════════════════════╗
-- ║ ⚠ 실행 금지 — 실데이터(실제 고객) 운영 중 (2026-06-06~)            ║
-- ║   이 스크립트는 전체 주문/구독을 삭제한다(회원 구분 없음).          ║
-- ║   실제 구독 고객이 존재하므로 절대 실행하지 말 것.                  ║
-- ║   아래 DELETE 는 안전을 위해 주석 처리(비활성화)해 두었다.          ║
-- ║   ※ 정식 오픈 전 빈 DB 초기화가 정말 필요할 때만, 데이터가 전부     ║
-- ║     테스트임을 확인한 뒤 주석을 해제해 사용한다.                    ║
-- ╚══════════════════════════════════════════════════════════════╝

-- 테스트 데이터 정리(전체): 모든 주문/구독 신청 삭제. 회원 계정은 보존.
-- 되돌릴 수 없음. (오픈 전 빈 DB 초기화 용도로만 — 현재는 비활성화)

-- ── 비활성화된 삭제 블록(실행 금지) ──
-- begin;
-- -- 1) 구독 슬롯 전부 삭제 → 선착순 정원이 다시 0명으로 열린다.
-- delete from public.subscription_slots;
-- -- 2) 주문 삭제. order_items 는 on delete cascade 로 함께 삭제된다.
-- delete from public.orders;
-- commit;
-- -- (선택) 선물 주소록도 비우려면: delete from public.recipients;

-- 현황 확인(읽기 전용 — 실행해도 안전):
select
  (select count(*) from public.orders)             as orders,
  (select count(*) from public.order_items)        as order_items,
  (select count(*) from public.subscription_slots) as subscription_slots;
