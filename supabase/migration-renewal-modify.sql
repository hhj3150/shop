-- ─────────────────────────────────────────────────────────────
-- 구독 연장 시 구성·요일·회차 변경 (Renewal Modify)
--
--   회원이 연장(재입금) 시 (1) 상품 구성, (2) 배송 요일, (3) 회차수(4/8/12주 = SubPeriod 1/2/3)를
--   바꿔서 연장한다. 변경은 "다음 블록"부터만 적용된다.
--
--   블록(block) 모델: 연장주문이 자기 order_items 를 갖고 renews_slot_id 로 슬롯에 체인된다.
--   order_items 가 없는 레거시 연장주문은 직전 블록을 상속 → 발송 명단은 오늘과 100% 동일.
--
--   본문 출처(라이브 최신):
--     - request_renewal: schema.sql + migration-special-delivery-renewal.sql(특수배송 분기)
--     - confirm_renewal_payment / cancel_subscription: schema.sql
--
-- ─────────────────────────────────────────────────────────────
-- ★ 선행 확인 (적용 전 1회):
--   1) 할인 정책이 4/8/12주 = 10/12/15% 인지 확인 (migration-period-weeks-tiers.sql 적용본):
--        select period_discount(1), period_discount(2), period_discount(3);
--      → 0.10 / 0.12 / 0.15 가 나와야 한다. (아니면 migration-period-weeks-tiers.sql 을 먼저 적용)
--      ⚠ 새 할인 함수를 만들지 않는다 — 라이브 period_discount 를 그대로 재사용한다.
--   2) 특수배송지역 판별 함수가 존재해야 한다 (migration-special-delivery-region.sql 적용본):
--        select public.is_special_delivery_postcode('63322');  -- true 나오면 OK
--      없으면 migration-special-delivery-region.sql 을 먼저 적용할 것.
--
-- 적용: Supabase SQL Editor 에서 이 파일을 위에서 아래로 한 번 실행. 멱등(create or replace / drop if exists).
--
-- ★ 적용 순서 의존(중요):
--   이 파일은 public.apply_renewal_slot_change(uuid) 를 정의한다(좌석 이동 + extended_weeks 공유 헬퍼).
--   migration-portone-payment.sql 의 confirm_payment 가 이 헬퍼를 호출하도록 갱신되었으므로,
--   ⇒ 이 파일(migration-renewal-modify.sql)을 먼저 적용한 뒤 갱신된 migration-portone-payment.sql 을 적용할 것.
--   (둘 다 create or replace 라 멱등 — 순서만 지키면 재적용 안전.)
-- ─────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════
-- A) request_renewal — 구성·요일·회차 변경 + order_items 생성
--    구 시그니처 request_renewal(bigint) 를 drop 하고 신 시그니처로 교체한다.
-- ═════════════════════════════════════════════════════════════
drop function if exists public.request_renewal(bigint);

create or replace function public.request_renewal(
  p_slot_id      bigint,
  p_items        jsonb,   -- [{product_id, qty}, ...]
  p_period       int,     -- 1 | 2 | 3 (= 4/8/12주)
  p_delivery_day text     -- 'mon'..'fri'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_slot         record;
  v_src          record;
  v_rate         numeric;
  v_weeks        int;
  v_item         jsonb;
  v_pid          text;
  v_qty          int;
  v_price        int;
  v_name         text;
  v_volume       text;
  v_unit         int;
  v_per_delivery int := 0;
  v_per_list     int := 0;
  v_taken        int;
  v_shipping     int;
  v_total        int;
  v_order_id     uuid;
  v_order_no     text;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  -- 본인·활성 슬롯 잠금
  select * into v_slot
    from public.subscription_slots
   where id = p_slot_id and user_id = v_uid and status = '활성'
   for update;
  if not found then raise exception '연장할 수 있는 활성 구독이 아닙니다.'; end if;

  -- 입금대기 연장 중복 거절
  if exists (select 1 from public.orders
              where renews_slot_id = p_slot_id and status = '입금대기') then
    raise exception '이미 연장 입금 대기 중인 주문이 있습니다. 입금 후 다시 시도해 주세요.';
  end if;

  -- 할인율(라이브 재사용) / 회차수 검증
  v_rate := public.period_discount(p_period);
  if v_rate is null then raise exception '구독 기간이 올바르지 않습니다.'; end if;
  v_weeks := p_period * 4;

  if p_delivery_day not in ('mon','tue','wed','thu','fri') then
    raise exception '배송 요일이 올바르지 않습니다.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '연장할 품목이 없습니다.';
  end if;

  -- 배송지·예금주 승계용 원 구독 주문
  select * into v_src from public.orders where id = v_slot.order_id;
  if not found then raise exception '원 구독 주문을 찾을 수 없습니다.'; end if;

  -- 금액 재계산(서버 권위) — 회당 상품 합계
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 0);
    if v_qty <= 0 then raise exception '수량이 올바르지 않습니다.'; end if;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid and active;
    if not found then raise exception '판매 종료된 제품이 있어 연장할 수 없습니다.'; end if;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    v_per_delivery := v_per_delivery + v_unit * v_qty;
    v_per_list     := v_per_list + v_price * v_qty;
  end loop;

  if v_per_delivery < 25000 then
    raise exception '회당 최소 상품 금액은 25,000원입니다.';
  end if;

  -- 요일 변경 사전 검사(권고; 권위 검사는 confirm_renewal_payment 에서 advisory lock 아래 재검사)
  if p_delivery_day <> v_slot.delivery_day then
    if exists (select 1 from public.subscription_slots
                where user_id = v_uid and delivery_day = p_delivery_day and status <> '해지') then
      raise exception '이미 그 요일에 구독이 있어 요일을 변경할 수 없습니다.';
    end if;
    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = p_delivery_day;
    if v_taken >= 100 then
      raise exception '선택한 요일이 마감되어 변경할 수 없습니다.';
    end if;
  end if;

  -- 배송비(특수배송지역 보존). 연장은 원 주문 배송지를 승계하므로 원 주문 우편번호로 판별.
  v_shipping := (case
    when public.is_special_delivery_postcode(v_src.ship_postcode) then 5000
    else 4000
  end) * v_weeks;
  v_total    := v_per_delivery * v_weeks + v_shipping;
  v_order_no := public.gen_order_no();

  insert into public.orders (
    user_id, order_no, total_amount, shipping_fee, has_subscription,
    block_weeks, period_months, order_type, depositor_name,
    ship_name, ship_phone, ship_postcode, ship_address, ship_address_detail, memo,
    is_gift, renews_slot_id
  ) values (
    v_uid, v_order_no, v_total, v_shipping, true,
    v_weeks, p_period, '구독', v_src.depositor_name,
    v_src.ship_name, v_src.ship_phone, v_src.ship_postcode,
    v_src.ship_address, v_src.ship_address_detail, v_src.memo,
    false, p_slot_id
  ) returning id into v_order_id;

  -- ★ 신규: 연장주문 자기 order_items (새 구성·요일·할인단가) — "다음 블록부터만" 의 핵심
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := v_item->>'product_id';
    v_qty := (v_item->>'qty')::int;
    select price, name, volume into v_price, v_name, v_volume
      from public.product_catalog where id = v_pid;
    v_unit := (round((v_price * (1 - v_rate)) / 10.0) * 10)::int;
    insert into public.order_items (order_id, product_id, product_name, volume, delivery_day, qty, unit_price)
      values (v_order_id, v_pid, v_name, v_volume, p_delivery_day, v_qty, v_unit);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_no', v_order_no, 'total', v_total);
end;
$$;

grant execute on function public.request_renewal(bigint, jsonb, int, text) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- B-0) apply_renewal_slot_change — 연장 입금확인의 "슬롯 측" 공유 헬퍼
--    ★ 좌석 이동(요일 변경분) + extended_weeks 누적만 수행한다. 주문 status 는 호출자 소관.
--    두 확인 경로(관리자 수동 confirm_renewal_payment / PayAction·PortOne 자동 confirm_payment)가
--    이 단일 헬퍼를 호출해 좌석 이동 누락으로 더는 갈리지 않도록 한다(이중예약 방지).
-- ═════════════════════════════════════════════════════════════
create or replace function public.apply_renewal_slot_change(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot    bigint;
  v_weeks   int;
  v_day     text;
  v_cur_day text;
  v_uid     uuid;
  v_taken   int;
begin
  select renews_slot_id, block_weeks into v_slot, v_weeks
    from public.orders where id = p_order_id;
  if v_slot is null then raise exception '연장 주문이 아닙니다.'; end if;

  -- 연장주문의 발송요일(자기 order_items; 블록 단위 단일 요일)
  select delivery_day into v_day from public.order_items where order_id = p_order_id limit 1;

  -- 슬롯 잠금 + 현재 요일·소유자
  select delivery_day, user_id into v_cur_day, v_uid
    from public.subscription_slots where id = v_slot for update;

  -- 요일 변경분이면 좌석 이동(권위 재검사).
  if v_day is not null and v_day <> v_cur_day then
    -- create_subscription_order 와 동일 lock 네임스페이스(반드시 hashtext)
    perform pg_advisory_xact_lock(hashtext('slot_day:' || v_day));

    if exists (select 1 from public.subscription_slots s
                where s.user_id = v_uid
                  and s.delivery_day = v_day
                  and s.status <> '해지'
                  and s.id <> v_slot) then
      raise exception '대상 요일에 이미 구독이 있어 좌석을 이동할 수 없습니다.';
    end if;

    select count(*) filter (where status in ('신청','활성')) into v_taken
      from public.subscription_slots where delivery_day = v_day;
    if v_taken >= 100 then
      raise exception '대상 요일이 마감되어 좌석을 이동할 수 없습니다.';
    end if;

    -- 부분 유니크 인덱스 subscription_slots_user_day_uniq (user_id, delivery_day) where status<>'해지'
    -- 와의 레이스(23505)를 사용자 메시지로 변환.
    begin
      update public.subscription_slots set delivery_day = v_day where id = v_slot;
    exception when unique_violation then
      raise exception '대상 요일에 이미 구독이 있어 좌석을 이동할 수 없습니다.';
    end;
  end if;

  update public.subscription_slots
     set extended_weeks = extended_weeks + v_weeks
   where id = v_slot;
end;
$$;

-- 내부 definer 호출(confirm_*)엔 별도 grant 불필요하나, 관리자 경로 호환 위해 유지.
grant execute on function public.apply_renewal_slot_change(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- B) confirm_renewal_payment — 관리자 수동 연장 입금확인.
--    시그니처 (p_order_id uuid) 불변. 관리자 클라이언트 무수정.
--    주문 status='입금확인' 후 슬롯 측은 공유 헬퍼(apply_renewal_slot_change)에 위임.
-- ═════════════════════════════════════════════════════════════
create or replace function public.confirm_renewal_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;

  -- 연장 주문 검증 + 주문 잠금
  if not exists (
    select 1 from public.orders
     where id = p_order_id and renews_slot_id is not null
     for update
  ) then
    raise exception '연장 주문이 아닙니다.';
  end if;

  update public.orders set status = '입금확인' where id = p_order_id;
  perform public.apply_renewal_slot_change(p_order_id);
end;
$$;

grant execute on function public.confirm_renewal_payment(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- C) cancel_subscription — 블록별 환불(평균식 대체)
--    시그니처·사유·환불계좌·상태전이·좌석반환 등 나머지 100% 보존.
--    환불 산식만 외과적으로 교체한다.
--
--   ★ 회귀 핀(의도):
--     - 단일 블록 AND extended_weeks = 0  → 기존 평균식과 동일한 결과.
--     - 연장 이력(extended_weeks > 0)       → 남은 회차의 소속 블록 단가로 상향 정정(의도).
--       (기존 RPC 는 연장분·extended_weeks 를 무시해 과소환불 상태였다.)
--
--   ★ 회차 SSOT: delivered 는 lib/subscription-schedule.ts 의 computeSchedule 규칙을 그대로 재현한다.
--       k회차 예정일 = started_at + (k-1)*7 + 누적정지일,  예정일 <= today(KST) 인 회차까지 delivered.
--     기존 인라인 산식 least(total, elapsed/7+1) 을 복제하지 않는다(경계 일치 보장).
-- ═════════════════════════════════════════════════════════════
create or replace function public.cancel_subscription(
  p_slot_id        bigint,
  p_reason         text,
  p_refund_account text
)
returns integer   -- 서버가 계산한 환불액(원)을 반환
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_started      date;
  v_paused       boolean;
  v_paused_at    date;
  v_paused_days  int;
  v_today        date := (now() at time zone 'Asia/Seoul')::date;
  v_pdays        int;
  v_order_id     uuid;
  -- 블록 누적 배열 (id 순). 각 인덱스 i 가 하나의 블록.
  v_weeks_arr    int[]  := array[]::int[];   -- 블록 회차수
  v_prod_arr     int[]  := array[]::int[];   -- 블록 회당 상품 합계
  v_ship_arr     int[]  := array[]::int[];   -- 블록 회당 배송비
  v_from_arr     int[]  := array[]::int[];   -- 블록 fromRound (1-base 포함)
  v_to_arr       int[]  := array[]::int[];   -- 블록 toRound   (1-base 미포함)
  v_blk          record;
  v_bw           int;
  v_prod         int;
  v_ship         int;
  v_last_prod    int := 0;   -- 직전 블록 상속용
  v_last_ship    int := 0;
  v_cursor       int := 1;   -- 누적 회차 커서
  v_total        int := 0;   -- Σ block_weeks
  v_delivered    int := 0;
  v_refund       int := 0;
  v_k            int;
  v_i            int;
begin
  -- 본인 슬롯 잠금(활성·대기). 원주문 id 도 확보.
  select s.started_at, s.paused, s.paused_at, s.paused_days, s.order_id
    into v_started, v_paused, v_paused_at, v_paused_days, v_order_id
    from public.subscription_slots s
   where s.id = p_slot_id
     and s.user_id = v_uid
     and s.status in ('활성','대기')
   for update of s;
  if not found then
    raise exception '해지할 수 있는 구독이 아닙니다.';
  end if;

  -- ── 블록 배열 구성: 원주문 + 입금확인류 연장주문을 시간순으로 ──
  --   각 블록: block_weeks, 회당상품합 = Σ(oi.unit_price*oi.qty), 회당배송비 = round(shipping_fee/block_weeks)
  --   order_items 0건(레거시 연장)이면 직전 블록의 회당상품합·회당배송비를 상속(normalizeBlocks 와 동일).
  --   ⚠ TS SSOT(buildRawBlocks)는 원주문을 항상 block0 으로 고정하고 연장만 정렬한다 → 동일하게 맞춘다.
  --     orders.id 는 random uuid(비단조) 라 시간순이 아니므로 연장은 created_at 으로 정렬(id 는 결정적 tiebreaker).
  --     입금대기 연장은 동시 1건만 허용되므로 created_at 이 진짜 블록 시간순을 반영한다.
  for v_blk in
    select o.id,
           coalesce(o.block_weeks, 0) as block_weeks,
           coalesce(o.shipping_fee, 0) as shipping_fee
      from public.orders o
     where o.id = v_order_id
        or (o.renews_slot_id = p_slot_id
            and o.status in ('입금확인','배송준비','배송중','배송완료'))
     order by case when o.id = v_order_id then 0 else 1 end, o.created_at, o.id
  loop
    v_bw := greatest(0, v_blk.block_weeks);

    select coalesce(sum(oi.unit_price * oi.qty), 0)
      into v_prod
      from public.order_items oi
     where oi.order_id = v_blk.id;

    if exists (select 1 from public.order_items oi where oi.order_id = v_blk.id) then
      -- 자기 items 보유 블록 (v_prod 는 위 select 에서 채워짐)
      v_ship := case when v_bw > 0 then round(v_blk.shipping_fee::numeric / v_bw)::int else 0 end;
      v_last_prod := v_prod;
      v_last_ship := v_ship;
    else
      -- 레거시(빈 블록) → 직전 블록 상속
      v_prod := v_last_prod;
      v_ship := v_last_ship;
    end if;

    v_weeks_arr := v_weeks_arr || v_bw;
    v_prod_arr  := v_prod_arr  || v_prod;
    v_ship_arr  := v_ship_arr  || v_ship;
    v_from_arr  := v_from_arr  || v_cursor;
    v_to_arr    := v_to_arr    || (v_cursor + v_bw);
    v_cursor    := v_cursor + v_bw;
  end loop;

  v_total := v_cursor - 1;  -- Σ block_weeks

  -- ── delivered := computeSchedule 규칙 재현 ──
  if v_started is null then
    v_delivered := 0;
  else
    v_pdays := v_paused_days
             + case when v_paused and v_paused_at is not null
                    then greatest(0, v_today - v_paused_at) else 0 end;
    v_delivered := 0;
    for v_k in 1..v_total loop
      -- k회차 예정일이 미래면 중단(예정일 <= today 인 회차까지 발송 완료로 카운트)
      exit when (v_started + ((v_k - 1) * 7 + v_pdays)) > v_today;
      v_delivered := v_k;
    end loop;
  end if;

  -- ── 환불 := 남은 회차(delivered+1 .. total)의 소속 블록 단가(회당상품합 + 회당배송비) 합 ──
  for v_k in (v_delivered + 1)..v_total loop
    -- k 가 속한 블록 i = [from_arr[i], to_arr[i]) 구간(누적 회차)
    for v_i in 1..array_length(v_weeks_arr, 1) loop
      if v_k >= v_from_arr[v_i] and v_k < v_to_arr[v_i] then
        v_refund := v_refund + v_prod_arr[v_i] + v_ship_arr[v_i];
        exit;  -- 블록 1개만 매칭
      end if;
    end loop;
  end loop;

  update public.subscription_slots
     set status         = '해지',
         paused         = false,
         paused_at      = null,
         cancel_reason  = p_reason,
         refund_account = p_refund_account,
         refund_amount  = v_refund,
         cancelled_at   = v_today
   where id = p_slot_id;

  return v_refund;
end;
$$;

grant execute on function public.cancel_subscription(bigint, text, text) to authenticated;


-- ───────── 사장님 적용 절차 ─────────
-- 1) (선행 확인) 위 "★ 선행 확인" 두 항목(period_discount 0.10/0.12/0.15, is_special_delivery_postcode 존재) 점검.
-- 2) 이 파일을 Supabase SQL Editor 에서 한 번 실행(A→B→C 순서대로).
-- 3) 검증:
--    a) 연장 신청(요일 그대로, 8주): request_renewal(slot, '[{"product_id":"milk-750","qty":3}]', 2, '<현재요일>')
--       → orders.shipping_fee = (제주 5000 / 일반 4000) × 8, order_items 3행(unit_price=할인단가, delivery_day=요일).
--    b) 요일 변경 연장: 다른 요일로 신청 → confirm_renewal_payment 시 slot.delivery_day 가 새 요일로 이동.
--       대상 요일 본인 중복/100석 마감이면 친절 예외.
--    c) 환불 동치: 연장 이력 없는 구독 해지 → 기존과 동일 환불액.
--       연장 이력 있는 구독 해지 → 남은 회차 블록 단가 정밀 합산(상향 정정).
--       같은 시작일·정지로 lib refundByBlocks(TS) 미리보기와 RPC 반환값 1건 대조.
