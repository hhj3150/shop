-- 재구독 안내는 '결제한 회차를 다 보낸 뒤'에 나간다.
--
--   [무엇이 잘못됐었나]
--     renewal_reminder_targets 는 종료일을 달력으로 잡았다 — started_at 에서 total 회차를
--     센 마지막 날. 그런데 실제로 그날까지 total 회가 나갔다는 보장이 없다.
--     박재우 님은 24회를 결제하고 10회를 받은 상태에서, 달력이 '다음 주가 마지막 회차'라고
--     해서 재구독 안내를 받았고 8주를 더 결제했다. 남은 14회는 그대로 둔 채로.
--
--   [무엇을 바꾸나]
--     회차가 확정된 구독은 종료일을 '남은 회차가 다 나가는 날'로 잡는다.
--       남은 회차 = 결제 회차 - 실제 발송 회차
--       종료일   = 오늘 이후 배송 슬롯을 남은 회차만큼 센 그 마지막 날
--     이미 다 보냈으면(남은 0) 종료일 = 오늘 → 그날 바로 종료·재구독 안내가 나간다.
--
--   [확정 전에는 아무것도 바뀌지 않는다]
--     slot_shipped_rounds() 가 null 을 주는 미확정 슬롯은 옛 달력 규칙 그대로다.
--     적용 시점 기준 활성 92건이 전부 미확정이라, 이 마이그레이션의 당장 동작 변화는 0 이다.
--     관리자가 한 명 확정하는 순간 그 구독만 '다 보낸 뒤에 안내'로 바뀐다.
--
--   [왜 확정보다 먼저 적용해야 하나]
--     순서가 거꾸로면, 사장님이 회차를 확정해도 문자는 여전히 달력을 보고 먼저 나간다.
--     확정의 효과가 배송에는 들고 안내에는 안 드는 반쪽짜리가 된다.
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
    select b.slot_id, b.name, b.phone,
           case
             -- 미확정: 옛 규칙 그대로(달력상 마지막 회차일).
             when b.shipped is null then (
               select d.ship_date
                 from public.sub_delivery_dates(
                        b.started_at, b.first_ship_date, b.total, b.paused_days
                      ) d
                order by d.k desc
                limit 1
             )
             -- 결제분을 이미 다 보냈다 → 오늘이 종료일. 안내가 지금 나가야 한다.
             when b.shipped >= b.total then v_today
             -- 남은 회차가 다 나가는 날. 오늘 이후 배송 슬롯을 (결제 - 발송)개 센 마지막 날이다.
             --   생성 구간을 '결제 회차 + 지금까지 경과 주수 + 2'로 늘려, 밀린 만큼
             --   달력 끝을 넘어가도 남은 회차가 들어갈 자리가 모자라지 않게 한다.
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
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from computed c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between (v_today - 3) and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$function$;
