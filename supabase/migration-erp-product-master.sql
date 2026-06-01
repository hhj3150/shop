-- ─────────────────────────────────────────────────────────────
-- ERP 상품 마스터 강화: 원가(cost) · 재고(stock)
--   product_catalog 는 이미 가격(price)·노출(active)의 단일 출처이며
--   관리자(is_admin)만 INSERT/UPDATE 가능(catalog_*_admin 정책).
--   여기에 ERP 운영을 위한 두 컬럼을 더한다.
--     cost  = 1개당 원가(원). 마진(매출-원가) 분석에 사용. 기본 0.
--     stock = 완제품 재고 수량. NULL = 무제한(재고 미관리),
--             0 = 품절. 관리자가 일배치 생산 후 수동 보정한다.
--   별도 RLS 변경 불필요(기존 catalog_update_admin 으로 관리자 수정).
-- 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

alter table public.product_catalog
  add column if not exists cost  integer not null default 0 check (cost >= 0),
  add column if not exists stock integer check (stock is null or stock >= 0);
