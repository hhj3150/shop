-- apply_recovery_action 가 '실제로 취소했는지'를 boolean 으로 반환하도록 변경.
-- 목적: 입금 마감 자동취소(expire) 시 구매자에게 취소 안내 문자를 보내되,
--   조회~실행 사이에 입금되어 no-op 된 경우(막판 입금)에는 문자를 보내지 않기 위함.
--   기존엔 returns void 라 크론이 '취소됨/no-op'을 구분할 수 없었다.
--
-- 반환: expire 가 입금대기→취소를 실제로 수행하면 true, 그 외(D1/D2 기록, 막판입금 no-op)는 false.
-- 본문 로직은 migration-payment-recovery.sql 과 동일 — 반환값만 추가.
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   반환 타입 변경이라 create or replace 불가 → drop 후 재생성. 호출처는 Netlify
--   payment-recovery 함수뿐이라 잠깐의 부재는 무해(일 1회 00:00 UTC 실행).
--   선행: migration-payment-recovery.sql.

drop function if exists public.apply_recovery_action(text, uuid, text);

create function public.apply_recovery_action(
  p_secret   text,
  p_order_id uuid,
  p_action   text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_status   text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_action in ('D1', 'D2') then
    insert into public.order_reminders(order_id, stage)
      values (p_order_id, p_action)
      on conflict (order_id, stage) do nothing;
    return false;
  end if;

  if p_action = 'expire' then
    select status into v_status
      from public.orders
     where id = p_order_id
     for update;
    if not found then raise exception 'order_not_found'; end if;
    -- 경합: 조회~실행 사이 입금되면 status가 바뀌므로 취소하지 않는다(문자도 안 나감).
    if v_status <> '입금대기' then return false; end if;

    update public.subscription_slots
       set status       = '해지',
           cancel_reason = '입금 마감 자동취소',
           cancelled_at  = v_today
     where order_id = p_order_id and status in ('신청', '대기');

    update public.orders set status = '취소' where id = p_order_id;
    return true;
  end if;

  raise exception 'bad_action: %', p_action;
end;
$$;

revoke all on function public.apply_recovery_action(text, uuid, text) from public;
grant execute on function public.apply_recovery_action(text, uuid, text) to anon;
