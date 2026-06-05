-- ─────────────────────────────────────────────────────────────
-- 특수배송지역 판별 목록 확장 (제주·울릉 + 인천/충남 도서)
--
--   migration-special-delivery-region.sql 의 is_special_delivery_postcode 를
--   국내 택배사 표준 도서산간표(로젠 포함) 기준으로 확장한다.
--   create_subscription_order / _create_once_order_core / request_renewal 는
--   이 함수를 이름으로 호출하므로, 함수만 교체하면 신규·갱신 주문 모두에 반영된다.
--
--   ⚠ 동기화: lib/regions.ts 의 SPECIAL_RANGES + EXTRA_SPECIAL_POSTCODES 와 동일.
--   ※ 남부 도서(전남 신안·완도·진도, 경남 통영, 여수 등)는 표준표에 코드가
--     명시돼 있지 않아 미포함 — 로젠 공식 목록을 받으면 여기와 lib/regions.ts 에 함께 추가.
--
-- 멱등: create or replace. 적용: Supabase SQL Editor 에서 한 번 실행.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_special_delivery_postcode(p_postcode text)
returns boolean
language sql
immutable
as $$
  select case
    when length(d) <> 5 then false
    -- 충남 개별 도서(편집 가능). lib/regions.ts 의 EXTRA_SPECIAL_POSTCODES 와 동기화.
    when d in ('31708', '32133', '33411') then true
    else (d::int between 63000 and 63644)   -- 제주특별자치도 전역
      or (d::int between 40200 and 40240)    -- 경상북도 울릉군(울릉도·독도)
      or (d::int between 22386 and 22388)    -- 인천 중구 섬(무의도 등)
      or (d::int between 23004 and 23010)    -- 인천 강화군 섬(교동·서도 등)
      or (d::int between 23100 and 23116)    -- 인천 옹진군 섬 1(북도·연평 등)
      or (d::int between 23124 and 23136)    -- 인천 옹진군 섬 2(백령·대청·덕적 등)
  end
  from (select regexp_replace(coalesce(p_postcode, ''), '[^0-9]', '', 'g')) as t(d);
$$;

-- ───────── 사장님 적용 절차 ─────────
-- 1) Supabase SQL Editor 에서 위 함수를 실행(교체).
-- 2) 검증:
--      select public.is_special_delivery_postcode('63322');  -- 제주 → true
--      select public.is_special_delivery_postcode('22387');  -- 인천 무의도 → true
--      select public.is_special_delivery_postcode('23130');  -- 백령 등 → true
--      select public.is_special_delivery_postcode('31708');  -- 충남 당진 섬 → true
--      select public.is_special_delivery_postcode('06236');  -- 서울 → false
-- 3) 기존 create_*/request_renewal 는 그대로 두면 된다(이 함수를 이름으로 호출).
