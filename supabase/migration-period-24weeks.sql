-- 정기구독 24주(20%) 추가 — 서버 단일 권위 period_discount 에 한 줄.
--   p_months: 1=4주(10%), 2=8주(12%), 3=12주(15%), 6=24주(20%). 그 외는 null →
--   create_subscription_order / request_renewal 이 '구독 기간이 올바르지 않습니다.' 로 거절.
--   두 함수 본문은 무변경: 이미 period_discount(p_period) 와 p_period * 4 를 쓰므로
--   6 을 받으면 24주·20% 로 계산된다(2026-11-11 운영 DB 정의로 확인).
--   ⚠ migration-period-weeks-tiers.sql 을 대체(supersede)한다. 4·5 는 일부러 열지 않는다
--     (16주·20주 상품은 없다).
--   기존 값(1·2·3)은 그대로라 진행 중인 주문·연장에 영향 없음. 멱등: create or replace.
--   ★ 화면(lib/products.ts 의 PERIOD_DISCOUNT)보다 먼저 적용한다 — 화면이 먼저 나가면
--     24주를 고른 손님의 주문이 서버에서 거절된다.
create or replace function public.period_discount(p_months int)
returns numeric language sql immutable
set search_path to 'public'
as $$
  select case p_months
    when 1 then 0.10   -- 4주
    when 2 then 0.12   -- 8주
    when 3 then 0.15   -- 12주
    when 6 then 0.20   -- 24주
    else null
  end;
$$;

-- ───────── 적용 절차 ─────────
-- 1) 적용 전:  select period_discount(1), period_discount(2), period_discount(3), period_discount(6);
--              → 0.10 / 0.12 / 0.15 / null
-- 2) 위 create or replace 실행.
-- 3) 적용 후:  같은 조회 → 0.10 / 0.12 / 0.15 / 0.20, period_discount(4)·(5) 는 null.
-- 4) 금액 검증 — milk-750(정가 12,000) × 3병, 배송비 4,000/주:
--      24주(20%): 병당 9,600 → 회당 28,800 → total_amount 787,200
