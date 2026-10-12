-- 문자 남용 차단 — 번호당 일일 상한 조회 RPC
--
--   [왜] /api/notify 는 로그인한 회원이면 누구나 부를 수 있고, 수신번호는 그 사람이
--     만든 주문의 ship_phone 이다. 즉 '임의의 번호'를 지정할 수 있다. 종류별 1회 제한
--     (sms_already_sent)은 주문 단위라, 주문을 계속 만들면 그만큼 문자가 나간다.
--     Solapi 요금은 목장이 낸다.
--
--   [무엇] 한 번호로 오늘(KST) 성공 발송된 건수를 센다. 호출 측이 상한과 비교해 막는다.
--     판정만 하고 막지는 않는다 — 어디까지 허용할지는 호출 맥락마다 다르다
--     (손님 안내는 상한 적용, 관리자 알림·브로드캐스트는 예외).
--
--   ⚠ 이 RPC 는 '보낼까 말까'를 정하지 않는다. 숫자만 돌려준다.
--     상한값은 서버 환경변수(SMS_DAILY_CAP_PER_PHONE)로 둔다 — 코드 배포 없이 조절한다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   선행: sms_log 테이블 + append_sms_log / sms_already_sent (문자 이력 마이그레이션).

do $$
begin
  if to_regclass('public.sms_log') is null then
    raise exception '선행 누락: sms_log — 문자 이력 마이그레이션 먼저 적용';
  end if;
end $$;

-- 오늘(KST) 이 번호로 성공 발송된 문자 수.
--   · 실패(ok=false)는 세지 않는다 — 실패 때문에 정상 재시도가 막히면 안 된다.
--   · 관리자 알림(channel='admin_alert')은 제외한다. 사고를 알리는 문자가 상한에
--     걸려 안 나가면 상한이 사고를 덮는 꼴이 된다.
--   · 번호는 숫자만 남겨 비교한다(010-1234-5678 과 01012345678 을 같게 본다).
create or replace function public.sms_daily_count(p_secret text, p_to_phone text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_phone    text := regexp_replace(coalesce(p_to_phone, ''), '[^0-9]', '', 'g');
  v_count    int;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if length(v_phone) < 9 then return 0; end if;

  select count(*)::int into v_count
    from public.sms_log l
   where regexp_replace(coalesce(l.to_phone, ''), '[^0-9]', '', 'g') = v_phone
     and l.ok is true
     and coalesce(l.channel, '') <> 'admin_alert'
     and (l.sent_at at time zone 'Asia/Seoul')::date
         = (now() at time zone 'Asia/Seoul')::date;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.sms_daily_count(text, text) to anon, authenticated;


-- 슬롯 단위 중복발송 판정 — '해지 접수' 문자는 슬롯당 한 번이면 된다.
--   기존 sms_already_sent 는 주문·회원 단위라, 한 주문에 요일이 둘이면 두 번째 슬롯의
--   해지 문자가 통째로 막힌다. 슬롯 키는 sms_log.meta->>'slotId' 에 남긴다.
create or replace function public.sms_already_sent_slot(
  p_secret  text,
  p_kind    text,
  p_slot_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;
  if p_slot_id is null then return false; end if;

  -- 성공 기록만 본다 — 실패는 재시도를 막지 않는다.
  return exists (
    select 1 from public.sms_log l
     where l.kind = p_kind
       and l.ok is true
       and (l.meta ->> 'slotId') = p_slot_id::text
  );
end;
$$;

grant execute on function public.sms_already_sent_slot(text, text, bigint) to anon, authenticated;


-- 조회 성능 — 번호+날짜로 자주 센다.
create index if not exists sms_log_phone_sent_at_idx
  on public.sms_log ((regexp_replace(coalesce(to_phone, ''), '[^0-9]', '', 'g')), sent_at);

-- 슬롯 단위 판정용.
create index if not exists sms_log_kind_slot_idx
  on public.sms_log (kind, ((meta ->> 'slotId'))) where ok is true;


-- 검증 (읽기만)
--   -- 오늘 가장 많이 받은 번호 (상한값 정할 때 참고)
--   select regexp_replace(coalesce(to_phone,''), '[^0-9]', '', 'g') as phone, count(*)
--     from public.sms_log
--    where ok is true and coalesce(channel,'') <> 'admin_alert'
--      and (sent_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
--    group by 1 order by 2 desc limit 10;
--   -- 하루 최대치 이력(최근 60일) — 정상 운영에서 몇 통까지 나갔는지
--   select d, max(c) from (
--     select (sent_at at time zone 'Asia/Seoul')::date d,
--            regexp_replace(coalesce(to_phone,''), '[^0-9]', '', 'g') p, count(*) c
--       from public.sms_log
--      where ok is true and coalesce(channel,'') <> 'admin_alert'
--        and sent_at > now() - interval '60 days'
--      group by 1, 2) t group by d order by 2 desc limit 10;
