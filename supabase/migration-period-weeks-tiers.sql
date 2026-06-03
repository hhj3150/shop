-- 정기구독 기간 할인 + 허용 기간 정의 (서버 단일 권위).
--   p_months: 1=4주, 2=8주, 3=12주. 그 외는 null → create_subscription_order가 예외.
--   ⚠ 이 파일은 migration-period-3months.sql(1→0.10,2→0.11,3→0.12)을 명시적으로 대체(supersede)한다.
--   create_subscription_order / request_renewal 본문은 무변경(이미 period_discount·p_period*4 사용).
-- 멱등: create or replace. 적용 전후 라이브 주문 흐름 무중단.
create or replace function public.period_discount(p_months int)
returns numeric language sql immutable as $$
  select case p_months
    when 1 then 0.10   -- 4주
    when 2 then 0.12   -- 8주
    when 3 then 0.15   -- 12주
    else null
  end;
$$;

-- ───────── 사장님 적용 절차 ─────────
-- 1) 적용 전(before) 현재 값 확인 — 어느 선행 마이그레이션이 라이브인지 캡처:
--      select period_discount(1), period_discount(2), period_discount(3);
--    (예: 3months가 라이브면 0.10 / 0.11 / 0.12 가 나온다 → 8/12주가 이미 노출 중일 수 있음)
-- 2) 위 create or replace 실행.
-- 3) 적용 후(after) 재확인 — 0.10 / 0.12 / 0.15 가 나와야 한다:
--      select period_discount(1), period_discount(2), period_discount(3);
-- 4) 각 기간 1건씩 테스트 주문으로 total_amount 육안 검증.
--    예) milk-750(정가 12,000) × 3병, 배송비 4,000/주:
--        4주(10%):  병당 10,800 → 회당 32,400 → total_amount 145,600
--        8주(12%):  병당 10,560 → 회당 31,680 → total_amount 285,440
--        12주(15%): 병당 10,200 → 회당 30,600 → total_amount 415,200
