-- 비회원 주문조회 강화 ① — 주문번호 엔트로피 + 시크릿 게이트 조회 + 주문자 연락처 권위값
--
--   [문제 1] 주문번호의 무작위 부분이 네 자리 숫자뿐이다.
--     gen_order_no() = 'SY' || YYYYMMDD || '-' || lpad(1000 + random()*9000, 4)
--     → 날짜를 알면 후보가 **9,000개**다. 전화번호 하나를 아는 사람이
--       lookup_order_by_no_phone 을 9,000번 부르면 그 날짜의 주문을 찾아낸다.
--       그 RPC 는 anon 에 열려 있고 호출 횟수 제한도 없다.
--     → 무작위 부분을 영숫자 8자로 늘린다(31^8 ≈ 8,500억). 길이 19자로
--       PayAction 한도(22자) 안에 들어간다. 기존 번호는 그대로 유효하다.
--
--   [문제 2] 조회 RPC 가 anon 에 직접 열려 있어 호출 제한을 걸 자리가 없다.
--     → 시크릿 게이트 3-인자판을 추가한다. Next API 라우트가 IP 제한을 건 뒤
--       서버에서만 부른다. anon 권한 회수는 배포 뒤에 ②로 따로 적용한다
--       (지금 회수하면 배포 전까지 조회 화면이 멈춘다).
--
--   [문제 3] PayAction 주문등록의 주문자 연락처가 클라이언트 값이다.
--     /api/payaction/register 가 금액·입금자명은 DB 권위값을 쓰면서
--     ordererPhone 은 body 값을 우선한다 → 임의의 번호로 PayAction 결제완료
--     알림톡을 보낼 수 있다. 주문자 연락처도 DB 에서 읽도록 RPC 를 추가한다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.
--   ★ 이 파일은 '추가'만 한다 — 아무 때나 적용해도 기존 동작이 멈추지 않는다.
--     권한 회수는 코드 배포를 확인한 뒤 migration-guest-lookup-revoke.sql 로 적용한다.
--   선행: lookup_order_by_no_phone(text,text), gen_order_no(), assistant_rate_check.

do $$
begin
  if to_regprocedure('public.lookup_order_by_no_phone(text,text)') is null then
    raise exception '선행 누락: lookup_order_by_no_phone';
  end if;
  if to_regprocedure('public.assistant_rate_check(text,integer,integer)') is null then
    raise exception '선행 누락: assistant_rate_check — 호출 제한에 재사용한다';
  end if;
end $$;


-- ── 1) 주문번호 — 무작위 부분을 영숫자 8자로 ────────────────────────────
--   혼동 문자(O·0·I·1·L)를 뺀 31자 알파벳. 손님이 전화로 불러 줄 때를 생각한 선택이다.
--   중복이면 다시 뽑는다 — 4자리 숫자 시절에는 하루 9,000개라 충돌이 현실적이었다.
create or replace function public.gen_order_no()
returns text
language plpgsql
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_date   text := to_char((now() at time zone 'Asia/Seoul'), 'YYYYMMDD');
  v_rand   text;
  v_no     text;
  i        int;
  tries    int := 0;
begin
  loop
    v_rand := '';
    for i in 1..8 loop
      v_rand := v_rand || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    v_no := 'SY' || v_date || '-' || v_rand;   -- 19자 (PayAction 한도 22자)
    exit when not exists (select 1 from public.orders where order_no = v_no);
    tries := tries + 1;
    if tries > 20 then
      raise exception '주문번호 생성 실패(중복)';
    end if;
  end loop;
  return v_no;
end;
$$;

grant execute on function public.gen_order_no() to anon, authenticated;


-- ── 2) 비회원 주문조회 — 시크릿 게이트판 ────────────────────────────────
--   본문은 기존 2-인자판과 같다(이름 마스킹·최소 필드·길이 하한). 앞에 시크릿만 붙인다.
--   이걸 쓰는 건 Next API 라우트뿐이고, 라우트가 IP 단위 호출 제한을 먼저 건다.
create or replace function public.lookup_order_by_no_phone(
  p_order_no text,
  p_phone    text,
  p_secret   text
)
returns jsonb
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
  return public.lookup_order_by_no_phone(p_order_no, p_phone);
end;
$$;

-- 실제 관문은 Vault 시크릿이다 — 서버만 가진다. grant 는 배관일 뿐이라
--   기존 시크릿 게이트 RPC(payaction_order_payload 등)와 같은 범위로 둔다.
--   (API 라우트는 anon 키로 접속해 시크릿을 인자로 넘긴다.)
grant execute on function public.lookup_order_by_no_phone(text, text, text)
  to anon, authenticated;


-- ── 3) 주문자 연락처 — DB 권위값 ────────────────────────────────────────
--   PayAction 등록 시 '결제완료 알림톡'이 갈 번호다. 지금은 클라이언트가 정한다.
--   선물 주문은 받는 분(ship_phone)이 아니라 보내는 분(주문한 회원)에게 가야 하므로,
--   회원 프로필 번호를 먼저 보고 없으면 배송 연락처로 떨어진다.
--   비회원 주문은 프로필이 없어 언제나 배송 연락처다.
create or replace function public.order_orderer_contact(p_order_no text, p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_o        record;
  v_phone    text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'confirm_payment_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  select o.user_id, o.is_gift, o.ship_phone
    into v_o
    from public.orders o
   where o.order_no = p_order_no;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  if v_o.is_gift and v_o.user_id is not null then
    select nullif(trim(coalesce(p.phone, '')), '') into v_phone
      from public.profiles p where p.id = v_o.user_id;
  end if;

  return jsonb_build_object(
    'found', true,
    'orderer_phone', coalesce(v_phone, nullif(trim(coalesce(v_o.ship_phone, '')), ''))
  );
end;
$$;

grant execute on function public.order_orderer_contact(text, text) to anon, authenticated;


-- 검증 (읽기만)
--   -- 새 주문번호 형식 — SY + 8자리 날짜 + '-' + 영숫자 8자, 19자
--   select public.gen_order_no();
--   -- 기존 번호는 그대로 조회된다(길이 하한 8자를 넘는다)
--   select length(order_no), count(*) from public.orders group by 1 order by 1;
--   -- 시크릿 없이 부르면 forbidden 이어야 한다
--   select public.lookup_order_by_no_phone('SY20260101-ABCDEFGH', '01000000000', 'wrong');
--   select oid::regprocedure::text, array_to_string(proacl, ' | ')
--     from pg_proc where proname in ('lookup_order_by_no_phone','order_orderer_contact');
