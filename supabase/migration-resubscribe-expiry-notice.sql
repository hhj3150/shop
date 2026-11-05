-- 재구독 손님에게 '만료됩니다' 문자가 매주 반복되던 문제 (2026-11-05, 송영신 님 실사고)
--
--   [증상] 같은 날 두 문자가 갔다.
--     09:01 "정기구독이 11월 11일에 만료됩니다. 재구독을 신청해 주세요."  ← 틀림
--     15:11 "상품이 발송되었습니다. (12회 중 2번째)"                    ← 맞음
--   손님은 10/18 에 이미 12주 구독을 새로 신청·입금했다. 그런데도 옛 4주 구독(slot 98)의
--   만료 예고가 10/14 → 10/18 → 10/22 → 10/25 → 10/29 → 11/01 → 11/05 일곱 번 나갔고,
--   만료일이 10/21 → 10/28 → 11/04 → 11/11 로 매주 한 칸씩 밀렸다.
--
--   [원인 1 — 회차가 영영 다 안 차는 구독]
--     10/21(수) 배송분은 그날 못 나가고 10/26(월)에 보충 출고됐다. 출고 기록은 '원래 회차
--     날짜'인 ship_date=10/21 로 남는다(실제 기록 시각 shipped_at 은 10/26).
--     관리자는 10/22 에 "3회로 확정 · 10/21분 미발송"이라고 기준점을 박았다.
--     slot_shipped_rounds 는 '확정일 이후 ship_date' 만 세므로 10/21 행을 영원히 못 센다.
--     → 발송 3/4 에서 멈춤 → 남은 1회가 매주 '다음 배송일'로 밀림 → 만료 예고 무한 반복.
--     같은 10/21 수요일 묶음이 걸린 구독이 4개(33·85·90·98) — 마이페이지 남은 회차·환불
--     금액까지 한 회씩 틀려 있었다(이 함수가 그 계산들의 원천이다).
--   [수정 1] 확정일 이후에 '실제로 기록된' 출고도 센다.
--     기준점의 정의가 "확정일까지 나간 회차 수"이므로, 확정일 뒤에 실제로 나간 상자는
--     그 숫자에 들어 있을 수 없다. ship_date 가 과거 회차 날짜여도 마찬가지다.
--     한 날짜 = 한 회차(distinct ship_date) 원칙은 그대로다.
--
--   [원인 2 — 연장 대신 '새 구독'으로 다시 신청한 손님]
--     재구독 안내 대상에서 빼는 조건이 "이 슬롯을 연장하는 입금대기 주문"뿐이었다.
--     손님이 연장 버튼이 아니라 상품 페이지에서 새로 구독하면(renews_slot_id 없음)
--     시스템은 이미 다시 신청했다는 걸 모른다.
--   [수정 2] 같은 손님이 같은 받는 분(주소 또는 전화)에게 새 구독을 넣었고, 그것이
--     '재구독'으로 보이면 옛 구독의 만료 예고·종료 안내를 보내지 않는다.
--     재구독으로 보는 기준(둘 중 하나):
--       · 옛 구독의 만료 예고를 이미 받은 뒤에 신청했다 (안내를 보고 다시 신청한 것)
--       · 옛 구독 만료일 14일 전 이후에 신청했다 (안내 전에 스스로 다시 신청한 것)
--     ★ 일부러 두 구독을 같이 받는 손님(월·수 두 번 등 — 실제 4명)은 처음부터 함께
--       신청했으므로 위 기준에 걸리지 않는다 → 각 구독의 만료 안내가 그대로 나간다.
--     ★ 선물(다른 받는 분)은 받는 분이 달라 걸리지 않는다.
--
--   [건드리지 않는 것] 만료일 계산 규칙(SSOT sub_delivery_dates), 미확정 슬롯의 달력 규칙,
--     연장 입금대기 제외, 단계 dedup(renewal_reminders) — 운영 DB 정의(2026-11-05 조회)를
--     그대로 옮기고 위 두 곳만 바꿨다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행. 멱등.

-- ── 1) 발송 회차: 확정일 뒤에 '실제로 기록된' 출고도 센다 ─────────────────────
create or replace function public.slot_shipped_rounds(p_slot_id bigint)
 returns integer
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
           when s.rounds_confirmed_count is null or s.rounds_confirmed_at is null then null
           else s.rounds_confirmed_count + (
             select count(distinct sl.ship_date)::int
               from public.shipment_log sl
              where (sl.ship_date > s.rounds_confirmed_at
                     or (coalesce(sl.shipped_at, sl.deducted_at) at time zone 'Asia/Seoul')::date
                          > s.rounds_confirmed_at)
                and (sl.order_id = s.order_id
                     or sl.order_id in (select r.id from public.orders r
                                         where r.renews_slot_id = s.id))
           )
         end
    from public.subscription_slots s
   where s.id = p_slot_id;
$function$;


-- ── 2) 재구독 안내 대상: 이미 새로 구독한 손님은 뺀다 ───────────────────────────
create or replace function public.renewal_reminder_targets(p_secret text)
 returns table(slot_id bigint, name text, phone text, expiry_date date, sent_stages text[])
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_expected text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select ds.decrypted_secret into v_expected
    from vault.decrypted_secrets ds
   where ds.name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
  with base as (
    select s.id as slot_id,
           s.user_id,
           o.created_at as order_created_at,
           o.ship_address,
           o.ship_phone,
           p.name as name,
           p.phone as phone,
           s.started_at,
           s.first_ship_date,
           s.paused_days,
           greatest(o.block_weeks + s.extended_weeks, 1) as total,
           public.slot_shipped_rounds(s.id) as shipped
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       and not exists (
         select 1 from public.orders r
          where r.renews_slot_id = s.id and r.status = '입금대기'
       )
  ),
  computed as (
    select b.slot_id, b.user_id, b.order_created_at, b.ship_address, b.ship_phone,
           b.name, b.phone,
           case
             when b.shipped is null then (
               select d.ship_date
                 from public.sub_delivery_dates(
                        b.started_at, b.first_ship_date, b.total, b.paused_days
                      ) d
                order by d.k desc
                limit 1
             )
             when b.shipped >= b.total then v_today
             else (
               select d.ship_date
                 from public.sub_delivery_dates(
                        b.started_at,
                        b.first_ship_date,
                        b.total + ((v_today - b.started_at) / 7)::int + 2,
                        b.paused_days
                      ) d
                where d.ship_date >= v_today
                order by d.k
                offset (b.total - b.shipped - 1)
                limit 1
             )
           end as expiry_date
      from base b
  ),
  live as (
    -- 이미 새 구독으로 다시 신청한 손님은 '재구독하세요'를 받을 이유가 없다.
    select c.*
      from computed c
     where not exists (
       select 1
         from public.orders n
         left join public.subscription_slots ns on ns.order_id = n.id
        where n.user_id = c.user_id
          and n.has_subscription
          and n.renews_slot_id is null
          and n.created_at > c.order_created_at
          and n.status <> '취소'
          and coalesce(ns.status, '활성') <> '해지'
          and ns.id is distinct from c.slot_id
          -- 같은 받는 분(주소 또는 전화) — 선물·다른 집 구독은 따로 안내한다.
          and (
            (nullif(regexp_replace(coalesce(n.ship_address, ''), '\s', '', 'g'), '')
               = regexp_replace(coalesce(c.ship_address, ''), '\s', '', 'g'))
            or (nullif(regexp_replace(coalesce(n.ship_phone, ''), '\D', '', 'g'), '')
               = regexp_replace(coalesce(c.ship_phone, ''), '\D', '', 'g'))
          )
          -- '재구독'으로 보이는 시점에 신청한 것만 — 처음부터 같이 받는 두 구독은 제외.
          and (
            exists (
              select 1 from public.renewal_reminders rr0
               where rr0.slot_id = c.slot_id and rr0.sent_at <= n.created_at
            )
            or (n.created_at at time zone 'Asia/Seoul')::date >= c.expiry_date - 14
          )
     )
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from live c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between (v_today - 3) and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$function$;
