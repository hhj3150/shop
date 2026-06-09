-- 단품 발송일 정책 변경: 금·토·일 주문 → 모두 월요일 발송.
-- 기존 next_dispatch_date 는 토→화·일→화 로 미뤘다(주말 입금확인 불가 가정).
-- 정책 변경으로 토·일도 금요일과 동일하게 다음 영업일(월)로 모은다.
--   규칙: 신청 다음 날을 최소 발송일로 잡고, 주말·공휴일이면 다음 영업일로 전진.
--     → 월~목은 다음 날, 금(→토)·토(→일)·일은 자연히 월요일로 수렴.
-- 클라이언트(lib/ship-date.ts)와 동일 규칙. kr_holidays 테이블은 holiday-dispatch 에서 생성됨.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.next_dispatch_date(p_order_date date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v date := p_order_date + 1;  -- 신청 다음 날이 최소 발송일
begin
  -- 주말·공휴일이면 다음 영업일로 미룬다(금→토→월, 토→일→월, 일→월).
  while extract(dow from v)::int in (0, 6)
        or exists (select 1 from public.kr_holidays h where h.d = v) loop
    v := v + 1;
  end loop;
  return v;
end;
$$;

grant execute on function public.next_dispatch_date(date) to anon, authenticated;
