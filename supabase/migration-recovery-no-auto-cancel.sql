-- 미입금 자동취소 폐지 — 취소는 반드시 관리자가 사실확인 후 수동으로.
--
-- 배경(실사고, 2026-07-05): 회원명(윤지연)과 입금자명(정광일)이 달라 무통장 자동매칭이
--   안 된 주문(SY20260702-9235)이 D+3 자동취소되며 '자동 취소되었습니다' 문자까지
--   나갔다 — 고객은 이미 7/2에 입금한 상태였고 불쾌 클레임 발생.
--   입금자명 불일치·계좌 확인 지연 등 '시스템이 모르는 입금'이 있는 한, 자동취소와
--   취소 문자는 오발송 위험이 구조적으로 존재한다.
--
-- 변경:
--   1) apply_recovery_action('expire') → 아무것도 하지 않고 false 반환(킬스위치).
--      (배포 전 크론이 남아 있어도 취소·문자가 더는 발생하지 않는다 — 하위호환)
--   2) 새 단계 'EXPIRE_NOTIFY': D+3 도달 시 관리자에게 1회 알림을 보내기 위한
--      원장 기록. 신규 기록이면 true, 이미 기록돼 있으면 false 를 반환해
--      크론이 관리자 알림을 딱 한 번만 보내게 한다.
--   3) order_reminders.stage 체크 제약에 'EXPIRE_NOTIFY' 허용 추가.
--
-- 이후 흐름: D+1·D+2 입금 안내(고객, 기존 유지) → D+3 관리자 알림(고객 문자 없음)
--   → 관리자가 입금 사실확인 후 [입금확인] 또는 [취소](이때만 취소 문자 발송, 기존
--   updateStatus → notify(order_cancelled) 경로).
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.

alter table public.order_reminders
  drop constraint if exists order_reminders_stage_check;
alter table public.order_reminders
  add constraint order_reminders_stage_check
  check (stage in ('D1', 'D2', 'EXPIRE_NOTIFY'));

create or replace function public.apply_recovery_action(
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
  v_inserted boolean := false;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_action in ('D1', 'D2', 'EXPIRE_NOTIFY') then
    -- 신규 기록 여부를 반환 — EXPIRE_NOTIFY 관리자 알림을 1회로 제한하는 데 쓴다.
    with ins as (
      insert into public.order_reminders(order_id, stage)
        values (p_order_id, p_action)
        on conflict (order_id, stage) do nothing
        returning 1
    )
    select count(*) > 0 into v_inserted from ins;
    return v_inserted;
  end if;

  if p_action = 'expire' then
    -- ★ 자동취소 폐지(2026-07-05 실사고): 입금자명 불일치 등으로 실제 입금을 시스템이
    --   모를 수 있어, 취소와 취소 문자는 관리자 사실확인 후 수동으로만 한다.
    --   구버전 크론 하위호환용 무해 no-op — false 반환이면 크론은 문자를 보내지 않는다.
    return false;
  end if;

  raise exception 'bad_action: %', p_action;
end;
$$;

revoke all on function public.apply_recovery_action(text, uuid, text) from public;
grant execute on function public.apply_recovery_action(text, uuid, text) to anon;
