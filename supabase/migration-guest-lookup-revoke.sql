-- 비회원 주문조회 강화 ② — anon 직접 호출 권한 회수
--
--   ★ 적용 순서가 중요하다. 이 파일은 **코드 배포를 확인한 뒤** 적용한다.
--     · 먼저: migration-guest-lookup-hardening.sql (추가만 — 아무 때나 안전)
--     · 그 다음: 코드 배포 (조회 화면이 /api/orders/lookup 라우트를 쓰도록 바뀐다)
--     · 마지막: 이 파일
--     배포 전에 적용하면 그 사이 비회원 주문조회 화면이 "조회 중 오류"를 낸다.
--
--   [왜] 2-인자판은 anon 에 열려 있어 브라우저가 직접 부를 수 있다. 그래서
--     호출 횟수를 셀 자리가 없다 — 주문번호를 무차별 대입해도 막을 방법이 없었다.
--     (주문번호 엔트로피는 ①에서 이미 늘렸지만, 기존 4자리 번호는 그대로 남아 있다.)
--     조회는 이제 Next API 라우트만 지나간다. 라우트가 IP 단위로 횟수를 제한한 뒤
--     3-인자 시크릿판을 부른다.
--
--   되돌리려면: grant execute on function public.lookup_order_by_no_phone(text, text)
--                 to anon, authenticated;

do $$
begin
  if to_regprocedure('public.lookup_order_by_no_phone(text,text,text)') is null then
    raise exception '선행 누락: 3-인자판 — migration-guest-lookup-hardening.sql 먼저 적용';
  end if;
end $$;

revoke execute on function public.lookup_order_by_no_phone(text, text) from anon;
revoke execute on function public.lookup_order_by_no_phone(text, text) from public;

-- 검증 (읽기만)
--   -- 2-인자판에 anon 이 없어야 한다. 3-인자판에는 있어야 한다(시크릿이 진짜 관문).
--   select oid::regprocedure::text, coalesce(array_to_string(proacl, ' | '), '(PUBLIC)')
--     from pg_proc where proname = 'lookup_order_by_no_phone' order by 1;
