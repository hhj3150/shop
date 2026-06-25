-- ─────────────────────────────────────────────────────────────
-- 재연장 무결점화: (A) 연장 입금확인 멱등성 가드, (B) 만료 임박 알림 만료일 보정
--
--   재연장(이미 1회 이상 연장한 구독을 또 연장) 흐름의 두 가지 결함을 외과적으로 고친다.
--   둘 다 create or replace — 멱등. 본문 출처(라이브 최신):
--     - confirm_renewal_payment        : migration-renewal-modify.sql
--     - renewal_reminder_targets       : migration-renewal-retention.sql
--
-- ★ 선행 의존:
--   - public.apply_renewal_slot_change(uuid) 가 이미 정의돼 있어야 한다(migration-renewal-modify.sql).
--   - public.renewal_reminders 원장 + 시크릿이 이미 있어야 한다(migration-renewal-retention.sql).
--
-- 적용: Supabase SQL Editor 에서 이 파일을 위에서 아래로 한 번 실행.
-- ─────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════
-- A) confirm_renewal_payment — 멱등성 가드 + 실질 행잠금
--
--   [버그] 기존 본문은 status 가드가 없어, 관리자가 동일 연장주문을 '입금확인'으로
--          다시 토글하면 apply_renewal_slot_change 가 재실행되어
--          extended_weeks 가 회차만큼 또 더해진다(예: +8회 연장이 +16회로). 결과:
--            · 고객에게 무상으로 추가 회차가 부여되고
--            · 해지 시 환불(cancel_subscription)이 그만큼 과다 산정된다.
--          또한 자동확인 경로(confirm_payment)는 'status <> 입금대기 → no-op' 가드가 있는데
--          관리자 경로엔 없어, 자동확인 후 관리자가 또 누르면 이중 적용된다.
--   [원인 보강] 기존 `if not exists (... for update)` 는 EXISTS 서브쿼리라 행잠금이
--          의도대로 걸리지 않는다 → 동시 확인(더블클릭/재시도)에서 둘 다 통과 가능.
--   [수정] 주문 행을 select ... into ... for update 로 실제 잠그고,
--          '입금대기' 가 아니면 아무것도 바꾸지 않고 즉시 반환(멱등 no-op).
--          시그니처 (p_order_id uuid) 불변 — 관리자 클라이언트 무수정.
-- ═════════════════════════════════════════════════════════════
create or replace function public.confirm_renewal_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot   bigint;
  v_status text;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;

  -- 연장 주문 행을 실제로 잠근다(동시 확인 직렬화).
  select renews_slot_id, status
    into v_slot, v_status
    from public.orders
   where id = p_order_id
   for update;
  if not found or v_slot is null then
    raise exception '연장 주문이 아닙니다.';
  end if;

  -- 멱등: 이미 '입금대기'가 아니면(이미 확인/취소 등) 아무 것도 바꾸지 않는다.
  --   → extended_weeks 이중 누적·좌석 이중 이동을 원천 차단.
  if v_status <> '입금대기' then
    return;
  end if;

  update public.orders set status = '입금확인' where id = p_order_id;
  perform public.apply_renewal_slot_change(p_order_id);
end;
$$;

grant execute on function public.confirm_renewal_payment(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════
-- B) renewal_reminder_targets — 만료일(=마지막 배송일) 보정
--
--   [버그] 기존 만료일 = started_at + (총회차 * 7) + paused_days
--          → 이는 "마지막 배송일 + 7일" 이라, 마지막 배송일 자체보다 1주 늦다.
--          계정 페이지의 "종료 예정"(computeSchedule.endDate = 마지막 배송일)과 어긋난다.
--          알림 윈도우가 [today, today+7] 이고 단계가 D-7/D-3 이므로, 결과적으로
--            · D-7 문자가 "마지막 배송 7일 전"이 아니라 마지막 배송 '당일' 에 나가고
--            · D-3 문자는 마지막 배송 '이후' 에 나간다(이미 구독이 끊긴 뒤).
--          재구독 유도라는 목적이 사실상 무력화된다.
--   [수정] 만료일 = started_at + ((총회차 - 1) * 7) + paused_days
--          (= computeSchedule 의 마지막 배송일 base 와 일치. 총회차는 최소 1로 보호.)
--          이로써 D-7 은 마지막 배송 7일 전, D-3 은 3일 전에 나가 끊기기 전에 안내된다.
--   주의(알려진 잔여 오차): 본 SQL 은 주말·공휴일 영업일 시프트(advanceToBusinessDay)와
--     1회차 공휴일 보정(first_ship_date)은 반영하지 않는다 → 마지막 배송이 주말/공휴일에
--     걸리면 실제보다 최대 며칠 이르게 안내될 수 있다(늦는 것보다 안전한 방향). 정밀
--     일치가 필요하면 후속으로 computeSchedule 로직을 SQL 로 포팅한다.
--   나머지(시크릿게이트·동의·입금대기 제외·dedup 원장)는 100% 보존.
-- ═════════════════════════════════════════════════════════════
create or replace function public.renewal_reminder_targets(p_secret text)
returns table (
  slot_id     bigint,
  name        text,
  phone       text,
  expiry_date date,
  sent_stages text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 시크릿 컬럼을 별칭(ds)으로 명시 — RETURNS TABLE 출력변수 name 과의 모호성 제거
  select ds.decrypted_secret into v_expected
    from vault.decrypted_secrets ds
   where ds.name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
  with computed as (
    select s.id as slot_id,
           p.name as name,
           p.phone as phone,
           -- 마지막 배송일 = 앵커 + (총회차-1)*7 + 누적정지일. (계정 페이지 endDate 와 일치)
           (s.started_at
              + ((greatest(o.block_weeks + s.extended_weeks, 1) - 1) * 7 + s.paused_days)
           ) as expiry_date
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       and p.marketing_consent = true
       and not exists (
         select 1 from public.orders r
          where r.renews_slot_id = s.id and r.status = '입금대기'
       )
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from computed c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between v_today and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$$;

revoke all on function public.renewal_reminder_targets(text) from public;
grant execute on function public.renewal_reminder_targets(text) to anon;


-- ───────── 사장님 적용 절차 ─────────
-- 1) 선행 확인: apply_renewal_slot_change, renewal_reminders 가 이미 있어야 한다
--    (migration-renewal-modify.sql, migration-renewal-retention.sql 적용본).
-- 2) 이 파일을 Supabase SQL Editor 에서 한 번 실행(A→B).
-- 3) 검증:
--    a) [멱등] 연장 입금확인을 같은 주문에 두 번 호출해도 slot.extended_weeks 가 1회분만 증가:
--         select extended_weeks from subscription_slots where id = <slot>;  -- 확인 전
--         select confirm_renewal_payment('<연장주문 uuid>');                -- 1차
--         select confirm_renewal_payment('<연장주문 uuid>');                -- 2차(no-op 이어야)
--         select extended_weeks from subscription_slots where id = <slot>;  -- +block_weeks 1회만 증가
--    b) [만료일] 한 슬롯의 종료예정(계정 페이지)과 아래 값이 같은 날짜인지 1건 대조:
--         select expiry_date from renewal_reminder_targets('<secret>') where slot_id = <slot>;
--       (단, 마지막 배송이 주말/공휴일이면 영업일 시프트만큼 며칠 이를 수 있음 — 의도된 잔여오차)
