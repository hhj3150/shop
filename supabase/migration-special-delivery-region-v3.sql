-- ─────────────────────────────────────────────────────────────
-- 특수배송지역 판별 목록 확장 v3 — 남부 도서(전남·경남·전북) 추가
--
--   migration-special-delivery-region-v2.sql 의 is_special_delivery_postcode 를
--   택배사 표준 도서산간표 기준으로 남부 도서까지 확장한다.
--   create_subscription_order / _create_once_order_core / request_renewal 는
--   이 함수를 이름으로 호출하므로, 함수만 교체하면 신규·갱신 주문 모두에 반영된다.
--
--   ⚠ 동기화: lib/regions.ts 의 SPECIAL_RANGES + EXTRA_SPECIAL_POSTCODES 와 동일.
--   ※ 섬지역만 한정 — 통영·여수 시내(육지), 진도·완도 본섬(교량연결)은 제외해 과청구 방지.
--   ※ 제외: 통영 '54000'(전북 코드로 표기된 출처 오류), 부산 강서구 가덕도
--     '46768~46771'(교량연결·출처 불일치) — 의도적으로 넣지 않음.
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
    -- 개별(단일) 도서 우편번호. lib/regions.ts 의 EXTRA_SPECIAL_POSTCODES 와 동기화.
    when d in (
      '31708', '32133', '33411',          -- 충남 당진·태안·보령 섬
      '58826',                             -- 전남 신안 섬 3
      '59106', '59127', '59129',           -- 전남 완도 섬 2·3·4
      '59650', '59766'                     -- 전남 여수 섬 1·2
    ) then true
    else (d::int between 63000 and 63644)   -- 제주특별자치도 전역
      or (d::int between 40200 and 40240)    -- 경상북도 울릉군(울릉도·독도)
      or (d::int between 22386 and 22388)    -- 인천 중구 섬(무의도 등)
      or (d::int between 23004 and 23010)    -- 인천 강화군 섬(교동·서도 등)
      or (d::int between 23100 and 23116)    -- 인천 옹진군 섬 1(북도·연평 등)
      or (d::int between 23124 and 23136)    -- 인천 옹진군 섬 2(백령·대청·덕적 등)
      -- 남부 도서(섬지역만 한정).
      or (d::int between 52570 and 52571)    -- 경남 사천 섬
      or (d::int between 53031 and 53033)    -- 경남 통영 섬 1
      or (d::int between 53089 and 53104)    -- 경남 통영 섬 2(한산·욕지·사량 등)
      or (d::int between 56347 and 56349)    -- 전북 부안 섬(위도 등)
      or (d::int between 57068 and 57069)    -- 전남 영광 섬
      or (d::int between 58760 and 58762)    -- 전남 목포 섬
      or (d::int between 58800 and 58810)    -- 전남 신안 섬 1
      or (d::int between 58816 and 58818)    -- 전남 신안 섬 2
      or (d::int between 58828 and 58866)    -- 전남 신안 섬 4
      or (d::int between 58953 and 58958)    -- 전남 진도 섬(조도면 등)
      or (d::int between 59102 and 59103)    -- 전남 완도 섬 1
      or (d::int between 59137 and 59166)    -- 전남 완도 섬 5
      or (d::int between 59781 and 59790)    -- 전남 여수 섬 3(거문도 등)
  end
  from (select regexp_replace(coalesce(p_postcode, ''), '[^0-9]', '', 'g')) as t(d);
$$;

-- ───────── 사장님 적용 절차 ─────────
-- 1) Supabase SQL Editor 에서 위 함수를 실행(교체).
-- 2) 검증(섬=true, 육지=false):
--      select public.is_special_delivery_postcode('58800');  -- 신안 섬 → true
--      select public.is_special_delivery_postcode('58826');  -- 신안 섬(단일) → true
--      select public.is_special_delivery_postcode('58955');  -- 진도 섬 → true
--      select public.is_special_delivery_postcode('59150');  -- 완도 섬 → true
--      select public.is_special_delivery_postcode('53100');  -- 통영 섬 → true
--      select public.is_special_delivery_postcode('59785');  -- 여수 섬 → true
--      select public.is_special_delivery_postcode('53000');  -- 통영 시내(육지) → false
--      select public.is_special_delivery_postcode('59700');  -- 여수 시내(육지) → false
--      select public.is_special_delivery_postcode('58900');  -- 진도읍(본섬) → false
--      select public.is_special_delivery_postcode('59100');  -- 완도읍(본섬) → false
--      select public.is_special_delivery_postcode('54000');  -- 제외(출처 오류) → false
-- 3) 기존 create_*/request_renewal 는 그대로 두면 된다(이 함수를 이름으로 호출).
