-- 구독 첫배송 공휴일 → 다음 영업일 보정.
--
-- 문제: confirm_payment 가 구독 슬롯 활성화 시 첫 배송일(started_at)을 '다음 선택 요일'로만
--   잡아 공휴일을 건너뛰지 않는다. 첫 배송 요일이 공휴일이면 신선식품(우유)이 그날 발송돼
--   택배 창고에 묶인다. (단품은 #51 next_dispatch_date 로 이미 공휴일 스킵.)
--
-- 설계(첫배송만, 다음 영업일 — 합의 2026-06-09):
--   started_at = 선택 요일 앵커(기존 그대로, 2회차+ cadence·요일 매칭 기준).
--   first_ship_date(신규, nullable) = 앵커가 공휴일/주말이면 다음 영업일, 아니면 null(보정 불필요).
--   → 1회차만 다음 영업일로 이동하고 2회차+ 는 앵커 요일 cadence 유지(주기 안 깨짐).
--   클라(computeSchedule)·관리자 로스터(buildRosterForDate)가 first_ship_date 를 읽어
--   1회차를 시프트일에 표시하고 앵커(공휴일) 당일엔 제외한다.
--
-- ⚠ 범위: 신규 가입 첫 배송만. 연장(renewal) 첫 배송·정상 운영 중 주차별 공휴일은 범위 밖
--   (로스터 엔진 레벨 — 별도 작업). kr_holidays 목록은 lib/holidays.ts 와 동반 갱신(연 1회).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   선행(모두 prod 적용됨): kr_holidays(migration-holiday-dispatch),
--     confirm_payment 최신 정의(migration-confirm-payment-shipdate, #69).

begin;

-- 사전 점검: 공휴일 테이블이 prod 에 있는지 확인(없으면 명확히 중단).
do $$
begin
  if to_regclass('public.kr_holidays') is null then
    raise exception '선행 누락: kr_holidays — migration-holiday-dispatch.sql 먼저 적용';
  end if;
end $$;

-- 1) 첫배송 보정일 컬럼(nullable, 백필 안전 — 기존 슬롯은 null = 1회차가 started_at).
alter table public.subscription_slots add column if not exists first_ship_date date;

-- 2) confirm_payment 재정의. migration-confirm-payment-shipdate.sql 본문을 그대로 보존하고,
--    step 7(구독 슬롯 활성화)에서 first_ship_date(공휴일 보정 첫배송일)를 함께 저장한다.
create or replace function public.confirm_payment(
  p_order_no    text,
  p_secret      text,
  p_paid_amount integer,
  p_pay_method  text default null,
  p_pg_tx_id    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected         text;
  v_order            record;
  v_slot             record;
  v_target           int;
  v_start            date;
  v_first            date;
  v_day_num          jsonb := '{"mon":1,"tue":2,"wed":3,"thu":4,"fri":5}'::jsonb;
  v_orphan_inserted  int := 0;
begin
  -- 1) 공유 시크릿 검증 (웹훅만 통과). 시크릿은 Vault에 보관 → 레포에 없음.
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  -- 2) 주문 조회 + 행 잠금 (동시 웹훅 재시도 대비)
  select * into v_order from public.orders where order_no = p_order_no for update;
  if not found then raise exception 'order_not_found'; end if;

  -- 3) 금액 재검증 (서버 권위값과 일치해야 입금확인)
  if p_paid_amount is null or p_paid_amount <> v_order.total_amount then
    raise exception 'amount_mismatch: paid=% expected=%', p_paid_amount, v_order.total_amount;
  end if;

  -- 4) 멱등: 이미 '입금대기'가 아니면 변경 없이 현재 상태 반환.
  --    단, '취소'된 주문에 입금이 들어온 경우(고아입금)는 원장에 적재하고, '이번에 처음 적재됐을 때만'
  --    orphan_inserted=true 로 알린다(웹훅 재전송 중복 알림 방지).
  if v_order.status <> '입금대기' then
    if v_order.status = '취소' then
      insert into public.orphan_deposits
        (order_no, pg_tx_id, order_id, paid_amount, pay_method, prior_status)
        values (
          v_order.order_no, coalesce(p_pg_tx_id, ''), v_order.id,
          p_paid_amount, p_pay_method, v_order.status
        )
      on conflict (order_no, pg_tx_id) do nothing;
      get diagnostics v_orphan_inserted = row_count;
      return jsonb_build_object(
        'order_id', v_order.id, 'order_no', v_order.order_no,
        'status', v_order.status, 'changed', false,
        'orphan', true, 'orphan_inserted', (v_orphan_inserted > 0),
        'order_type', v_order.order_type,
        'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
      );
    end if;
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', v_order.status, 'changed', false,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone
    );
  end if;

  -- 5) 연장 주문: 주문 결제기록 + 슬롯 측(좌석 이동 + extended_weeks 누적)은 공유 헬퍼에 위임.
  if v_order.renews_slot_id is not null then
    update public.orders
       set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
     where id = v_order.id;
    perform public.apply_renewal_slot_change(v_order.id);
    return jsonb_build_object(
      'order_id', v_order.id, 'order_no', v_order.order_no,
      'status', '입금확인', 'changed', true,
      'order_type', v_order.order_type,
      'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
      'ship_date', v_order.ship_date
    );
  end if;

  -- 6) 일반 주문: 상태 입금확인 + 결제 기록
  update public.orders
     set status = '입금확인', paid_at = now(), pay_method = p_pay_method, pg_tx_id = p_pg_tx_id
   where id = v_order.id;

  -- 7) 구독 주문이면 슬롯 활성화 (신청 → 활성).
  --    started_at = 선택 요일 앵커(첫 배송 요일, KST). first_ship_date = 앵커가 공휴일/주말이면
  --    다음 영업일(첫배송만 이동), 보정 불필요면 null. 2회차+ 는 앵커 요일 cadence 유지.
  if v_order.order_type = '구독' then
    for v_slot in
      select id, delivery_day from public.subscription_slots
       where order_id = v_order.id and status = '신청'
    loop
      v_target := (v_day_num ->> v_slot.delivery_day)::int;
      v_start  := (now() at time zone 'Asia/Seoul')::date + 1;
      while extract(dow from v_start)::int <> v_target loop
        v_start := v_start + 1;
      end loop;
      -- 첫배송 공휴일 보정: 앵커가 주말·공휴일이면 다음 영업일까지 전진(포함형).
      v_first := v_start;
      while extract(dow from v_first)::int in (0, 6)
            or exists (select 1 from public.kr_holidays h where h.d = v_first) loop
        v_first := v_first + 1;
      end loop;
      update public.subscription_slots
         set status = '활성',
             started_at = v_start,
             first_ship_date = case when v_first <> v_start then v_first else null end
       where id = v_slot.id;
    end loop;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id, 'order_no', v_order.order_no,
    'status', '입금확인', 'changed', true,
    'order_type', v_order.order_type,
    'ship_name', v_order.ship_name, 'ship_phone', v_order.ship_phone,
    'ship_date', v_order.ship_date
  );
end;
$$;

grant execute on function public.confirm_payment(text, text, integer, text, text) to anon, authenticated;

commit;

-- ───────── 수기 검증(적용 후 SQL Editor) ─────────
-- 1) 컬럼: select 1 from information_schema.columns
--      where table_name='subscription_slots' and column_name='first_ship_date';
-- 2) 첫배송이 공휴일에 걸리는 요일로 구독 주문 → 입금확인 웹훅 후:
--      select delivery_day, started_at, first_ship_date from subscription_slots
--       where order_id = '<신규 구독 order_id>';
--    → started_at = 공휴일(선택 요일), first_ship_date = 다음 영업일. 평일이면 first_ship_date=null.
-- 3) 계정 페이지 '다음 발송' 이 first_ship_date(다음 영업일)로 표시되는지,
--    관리자 배송명단에서 공휴일 당일 제외·다음 영업일 포함되는지 확인.
