-- 관리자 화면이 '지금 시스템이 보는 발송 회차'를 함께 읽는다.
--
--   [왜 필요한가]
--     확정값(rounds_confirmed_count)은 '그 날짜까지'의 숫자다. 그 뒤로는 출고 기록이
--     쌓이면서 실제 발송 회차가 매주 늘어난다. 그런데 확정 화면은 확정값만 보여 줬고,
--     한 번 확정한 구독은 입력칸이 사라져 다시 고칠 수도 없었다.
--     목장은 수기 장부로 정확히 세고 있으므로, 그 숫자를 언제든 다시 넣을 수 있어야 한다.
--     그러려면 '지금 몇으로 보고 있는지'가 화면에 있어야 비교가 된다.
--
--   [왜 admin_round_baseline_rows 에 컬럼을 더하지 않았나]
--     반환 컬럼을 바꾸려면 함수를 drop 해야 하는데(return type 변경 불가), 운영에서
--     drop function 이 반복해서 걸렸다. 기존 함수를 건드리지 않고 하나 더 두는 쪽이
--     안전하다 — 화면이 두 결과를 slot_id 로 합친다.
create or replace function public.admin_slot_shipped_rounds()
returns table (slot_id bigint, shipped int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  return query
    select s.id, public.slot_shipped_rounds(s.id)
      from public.subscription_slots s
     where s.status = '활성'
       and s.rounds_confirmed_at is not null;  -- 미확정은 null 이라 돌려줄 것이 없다
end;
$$;

revoke all     on function public.admin_slot_shipped_rounds() from public;
revoke execute on function public.admin_slot_shipped_rounds() from anon;
grant  execute on function public.admin_slot_shipped_rounds() to authenticated;
