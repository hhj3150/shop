-- 자동문자 누락 3건 보정 (2026-08 전수 점검)
--
--  이 파일은 한 번에 통째로 실행해도 안전하다(모두 CREATE OR REPLACE / 멱등).
--
--  1) payaction_order_payload: 입금확인 안내 문자에 필요한 필드(order_id·ship_date·
--     delivery_method·order_type)를 함께 돌려준다.
--     배경: PayAction 웹훅이 입금을 자동 매칭해도 문자가 나가지 않아, 2026-07-01~08-29
--           입금완료 69건 중 4건(관리자가 직접 누른 건)만 안내를 받았다.
--     is_guest 도 함께 내려, 비회원 주문접수 문자 라우트(/api/notify/guest)가
--     '비회원 주문만' 발송하도록 서버에서 판정할 수 있게 한다.
--
--  2) renewal_reminders / record_renewal_reminder: 'END'(구독 종료 안내) 단계 허용.
--
--  3) renewal_reminder_targets:
--     · marketing_consent 조건 제거 — 만료·종료 안내는 거래 정보성 문자다(광고 아님).
--       현재 활성 구독 73건 중 37건(51%)이 미동의라 만료 안내를 아예 못 받고 있었다.
--     · 윈도우를 (오늘-3 ~ 오늘+7)로 넓혀 만료 다음날 '종료 안내'가 나갈 수 있게 한다.
--       (단계 판정은 앱 코드 decideRenewalStage 가 한다: d<0 → END, d=0 → 없음,
--        1~3 → D3, 4~7 → D7.)
--     · 해지 슬롯·입금대기 연장주문이 있는 슬롯은 종전대로 제외한다.

-- ─────────────────────────────────────────────────────────────
-- 1) 입금확인 문자용 주문 페이로드 확장
-- ─────────────────────────────────────────────────────────────
create or replace function public.payaction_order_payload(p_order_no text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected text;
  v_o        record;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select id,
         (user_id is null) as is_guest,
         order_no,
         total_amount,
         depositor_name,
         ship_name,
         ship_phone,
         ship_date,
         delivery_method,
         order_type,
         is_gift,
         gifter_name,
         status,
         to_char((created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD"T"HH24:MI:SS') || '+09:00'
           as order_date
    into v_o
    from public.orders
   where order_no = p_order_no;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'order_id', v_o.id,
    'is_guest', v_o.is_guest,
    'order_no', v_o.order_no,
    'total_amount', v_o.total_amount,
    'depositor_name', v_o.depositor_name,
    'ship_name', v_o.ship_name,
    'ship_phone', v_o.ship_phone,
    'ship_date', v_o.ship_date,
    'delivery_method', v_o.delivery_method,
    'order_type', v_o.order_type,
    'is_gift', v_o.is_gift,
    'gifter_name', v_o.gifter_name,
    'status', v_o.status,
    'order_date', v_o.order_date
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 2) 종료 안내(END) 단계 허용
-- ─────────────────────────────────────────────────────────────
alter table public.renewal_reminders
  drop constraint if exists renewal_reminders_stage_check;
alter table public.renewal_reminders
  add constraint renewal_reminders_stage_check
  check (stage = any (array['D7'::text, 'D3'::text, 'END'::text]));

create or replace function public.record_renewal_reminder(
  p_secret text, p_slot_id bigint, p_stage text, p_expiry date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_stage not in ('D7', 'D3', 'END') then
    raise exception 'bad_stage: %', p_stage;
  end if;

  insert into public.renewal_reminders(slot_id, stage, expiry_date)
    values (p_slot_id, p_stage, p_expiry)
    on conflict (slot_id, stage, expiry_date) do nothing;
end;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 3) 만료·종료 안내 대상 — 마케팅 동의 조건 제거 + 종료 윈도우 포함
-- ─────────────────────────────────────────────────────────────
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
  with computed as (
    select s.id as slot_id,
           p.name as name,
           p.phone as phone,
           -- 마지막 배송일 = 총회차째 실제 배송일(영업일 시프트·휴무 이월 반영).
           --   계정 페이지 computeSchedule.endDate 와 동일 값.
           (select d.ship_date
              from public.sub_delivery_dates(
                     s.started_at,
                     s.first_ship_date,
                     greatest(o.block_weeks + s.extended_weeks, 1),
                     s.paused_days
                   ) d
             order by d.k desc
             limit 1) as expiry_date
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       -- 만료·종료 안내는 거래 정보성 문자다(광고 아님) → 마케팅 동의와 무관하게 보낸다.
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
   -- 만료 3일 전후. 뒤쪽(-3)은 '종료 안내'(END)용 — 크론이 하루 걸러도 뒤늦게 한 번 나간다.
   where c.expiry_date between (v_today - 3) and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$function$;
