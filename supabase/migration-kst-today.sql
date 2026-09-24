-- 날짜 기준 KST 통일 — kst_today() 헬퍼 + 남은 current_date 정리
--
--   [문제] 날짜 기준이 함수마다 달랐다. Postgres 의 current_date 는 UTC 기준이라
--     한국시간 00:00~09:00 에는 '어제'를 가리킨다. 그 아홉 시간 동안 조작하면
--     정지일·재개일·유통기한 판정이 하루씩 어긋난다.
--
--   [확인] 운영 DB 실측(2026-09-24). 외부 점검이 지적한 함수 대부분은 이미 KST 였고,
--     실제로 UTC 가 남아 있던 건 아래 셋뿐이다.
--
--       KST 이미 적용됨 : pause_subscription · resume_subscription · skip_next_delivery
--                         · auto_resume_skips · change_delivery_day · cancel_subscription
--                         · confirm_payment · gen_order_no · cancel_unpaid_order 등
--       UTC 잔존       : cancel_skip · admin_set_subscription_paused · stock_adjust
--
--     ※ 저장소의 schema.sql·migration-skip-week.sql 은 옛 정의라 UTC 로 보이지만,
--       운영 DB 는 그 뒤로 갱신되어 있다. 판단 기준은 언제나 pg_get_functiondef 다.
--     ※ _rg_expiry_check() 에도 current_date 가 있으나 PASS/FAIL 을 돌려주는 점검용
--       함수이고 운영 로직이 아니다 — 손대지 않는다.
--
--   [부수 수정] admin_set_subscription_paused 의 정지 보정이 옛 규칙이었다.
--     재개 시 '경과 일수'를 그대로 paused_days 에 더하는데, resume_subscription 은
--     migration-pause-missed-rounds.sql 이후 '놓친 회차 × 7일'을 쓴다. 관리자가 대행해
--     정지·재개하면 손님이 직접 한 것과 다른 회차가 나온다. 같은 규칙으로 맞춘다.
--     (이 함수 주석의 "기존 pause/resume_subscription 과 같은 current_date" 라는 설명은
--      그 둘이 KST 로 옮겨간 지금 더는 사실이 아니다.)
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: migration-pause-missed-rounds.sql(missed_delivery_weeks),
--         migration-change-delivery-day.sql(admin_set_subscription_paused),
--         migration-skip-week.sql(cancel_skip).

do $$
begin
  if to_regprocedure('public.missed_delivery_weeks(date,date,int,int,date,date)') is null then
    raise exception '선행 누락: missed_delivery_weeks — migration-pause-missed-rounds.sql 먼저 적용';
  end if;
end $$;


-- ── 1) 오늘(한국시간) ────────────────────────────────────────────────────
--   운영 로직에서 '오늘'이 필요하면 언제나 이 함수를 쓴다. current_date 를 직접 쓰면
--   한국시간 새벽 아홉 시간 동안 하루 어긋난다.
--   stable: 한 트랜잭션 안에서는 같은 값을 돌려준다(now() 와 같은 성질).
create or replace function public.kst_today()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Asia/Seoul')::date;
$$;

grant execute on function public.kst_today() to anon, authenticated;


-- ── 2) 건너뛰기 되돌리기 — 되돌릴 수 있는 기한 판정을 KST 로 ────────────
--   skip_resume_on 은 '건너뛸 배송일 + 1일'이다. UTC 로 비교하면 한국시간 기준
--   건너뛴 배송일 다음 날 오전에도 되돌리기가 통과한다. 그 배송은 이미 지나갔는데
--   7일 적립 없이 정지가 풀려 손님이 회차 하나를 잃는다.
create or replace function public.cancel_skip(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  update public.subscription_slots
     set paused = false, paused_at = null, skip_resume_on = null
   where id = p_slot_id and user_id = auth.uid()
     and paused = true and skip_resume_on is not null
     and skip_resume_on > public.kst_today();
  if not found then
    raise exception '되돌릴 수 있는 건너뛰기가 아닙니다(이미 지난 건너뛰기는 되돌릴 수 없습니다).';
  end if;
end;
$$;

grant execute on function public.cancel_skip(bigint) to authenticated;


-- ── 3) 관리자 대행 정지·재개 — KST + '놓친 회차' 규칙으로 통일 ──────────
--   전화로 "다음 달까지 쉬어 주세요" 하는 손님을 관리자가 대신 처리하는 경로다.
--   손님이 직접 한 것과 같은 결과가 나와야 한다 — 정지 보정도 resume_subscription 과
--   같은 '놓친 회차 × 7일'을 쓴다(경과 일수 올림이 아니다).
create or replace function public.admin_set_subscription_paused(
  p_slot_id bigint,
  p_paused  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   record;
  v_today  date := public.kst_today();
  v_total  int;
  v_missed int;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select * into v_slot from public.subscription_slots where id = p_slot_id for update;
  if not found then raise exception '구독을 찾을 수 없습니다.'; end if;
  if v_slot.status <> '활성' then
    raise exception '활성 구독만 정지·재개할 수 있습니다.';
  end if;

  if p_paused then
    if v_slot.paused then
      return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', false);
    end if;
    update public.subscription_slots
       set paused = true, paused_at = v_today, skip_resume_on = null
     where id = p_slot_id;
    return jsonb_build_object('slot_id', p_slot_id, 'paused', true, 'changed', true);
  end if;

  if not v_slot.paused then
    return jsonb_build_object('slot_id', p_slot_id, 'paused', false, 'changed', false);
  end if;

  -- 총 회차 = 원주문 block_weeks + 슬롯 extended_weeks (resume_subscription 과 동일).
  select greatest(coalesce(o.block_weeks, 0) + coalesce(v_slot.extended_weeks, 0), 1)
    into v_total
    from public.orders o
   where o.id = v_slot.order_id;
  v_total := coalesce(v_total, 1);

  -- 재개일 당일은 정상 발송된다 → [정지일, 재개일).
  v_missed := public.missed_delivery_weeks(
    v_slot.started_at, v_slot.first_ship_date, v_total,
    v_slot.paused_days, v_slot.paused_at, v_today
  );

  update public.subscription_slots
     set paused         = false,
         paused_at      = null,
         paused_days    = coalesce(paused_days, 0) + v_missed * 7,
         skip_resume_on = null
   where id = p_slot_id;

  return jsonb_build_object(
    'slot_id', p_slot_id, 'paused', false, 'changed', true,
    'missed_rounds', v_missed, 'added_days', v_missed * 7
  );
end;
$$;

revoke all on function public.admin_set_subscription_paused(bigint, boolean) from public;
revoke execute on function public.admin_set_subscription_paused(bigint, boolean) from anon;
grant execute on function public.admin_set_subscription_paused(bigint, boolean) to authenticated;


-- ── 4) 재고 조정 — 유통기한 만료 판정을 KST 로 ──────────────────────────
--   '오늘 유통기한'인 물건을 한국시간 새벽에 입고하면 UTC 로는 어제라 거부됐다.
create or replace function public.stock_adjust(
  p_product_id text,
  p_delta      integer,
  p_kind       text,
  p_note       text DEFAULT NULL,
  p_expiry     date DEFAULT NULL
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
  v_new   int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_kind not in ('입고','조정','폐기') then
    raise exception '거래 유형이 올바르지 않습니다: %', p_kind;
  end if;
  if p_delta = 0 then raise exception '변동 수량이 0 입니다.'; end if;
  -- 유통기한: 입고일 때만 의미. 이미 지난 날짜로는 입고 불가(오늘 만료분은 허용).
  if p_kind = '입고' and p_expiry is not null and p_expiry < public.kst_today() then
    raise exception '이미 만료된 유통기한입니다: %', p_expiry;
  end if;

  -- 현재고 행잠금(동시 차감 직렬화).
  select stock into v_stock from public.product_catalog
    where id = p_product_id for update;
  if not found then raise exception '존재하지 않는 제품입니다: %', p_product_id; end if;
  if v_stock is null then
    raise exception '무제한(재고 미관리) 품목은 조정할 수 없습니다. 먼저 현재고를 설정하세요.';
  end if;

  v_new := v_stock + p_delta;
  if v_new < 0 then
    raise exception '재고 부족: 현재고 % 에서 % 를 적용할 수 없습니다.', v_stock, p_delta;
  end if;

  update public.product_catalog set stock = v_new where id = p_product_id;
  -- expiry_date 는 입고일 때만 저장(다른 유형이 stray expiry 를 보내도 null).
  insert into public.stock_movements (product_id, delta, kind, note, expiry_date, created_by)
    values (p_product_id, p_delta, p_kind,
            nullif(trim(coalesce(p_note,'')),''),
            case when p_kind = '입고' then p_expiry else null end,
            auth.uid());

  return jsonb_build_object('product_id', p_product_id, 'stock', v_new);
end;
$$;

grant execute on function public.stock_adjust(text, integer, text, text, date) to authenticated;


-- 검증 (읽기만)
--   -- 운영 RPC 에 raw current_date 가 남았는가 — _rg_expiry_check(점검용) 만 나와야 한다
--   with f as (
--     select p.oid::regprocedure::text fn, pg_get_functiondef(p.oid) src
--       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prokind = 'f')
--   select fn from f where src like '%current_date%' order by 1;
--   -- 헬퍼가 KST 를 돌려주는가 (UTC 새벽이면 current_date 와 하루 차이)
--   select public.kst_today() as kst, current_date as utc, public.kst_today() - current_date as diff;
