-- 클레임 복기 1단계-A: 문자 발송 이력(sms_log).
--
-- 문제: 우리 DB에 SMS 발송 로그가 전혀 없어, "무슨 문자를 언제 받았/못받았나" 클레임을
--   사후에 확인할 수 없다(Solapi 콘솔 의존 — 번호기준·보관기간 한계).
--
-- 해결: 모든 발송(notify/broadcast/결제웹훅/고아입금알림)이 결과를 sms_log 에 적재한다.
--   서버 라우트는 다양한 인증(유저토큰/관리자/anon+시크릿)이라, 시크릿 게이트 RPC 하나로 통일한다.
--   (기록은 best-effort — 실패해도 발송/응답을 막지 않는다.)
--
-- 적용: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행.
--   시크릿: 기존 Vault confirm_payment_secret 을 재사용(추가 생성 불필요).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. 발송 로그 테이블.
--    RLS enable + 관리자 읽기 정책. insert 정책 없음 → SECURITY DEFINER RPC 로만 기록.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.sms_log (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete set null,
  order_id      uuid references public.orders(id) on delete set null,
  kind          text not null,                 -- payment_confirmed/shipped/welcome/broadcast 등
  to_phone      text,                           -- 수신번호(디지트). 단체는 대표 null + meta.recipients
  template_key  text,                           -- 알림톡 템플릿키(있으면)
  body          text,                           -- 실제 발송 본문(LMS 기준)
  channel       text,                           -- 'info' | 'bulk' | 'admin_alert' 등 발송 경로
  ok            boolean,                        -- 발송 성공 여부(솔라피 응답)
  fail_reason   text,
  meta          jsonb,                          -- 단체발송 recipients/skipped 등 부가정보
  sent_at       timestamptz not null default now()
);

create index if not exists sms_log_user_idx  on public.sms_log (user_id, sent_at desc);
create index if not exists sms_log_order_idx on public.sms_log (order_id, sent_at desc);
create index if not exists sms_log_phone_idx on public.sms_log (to_phone, sent_at desc);

alter table public.sms_log enable row level security;

-- 관리자만 조회(클레임 복기·Customer360). 클라이언트 insert 없음.
drop policy if exists sms_log_admin_read on public.sms_log;
create policy sms_log_admin_read on public.sms_log
  for select using (public.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 2. 적재 RPC. 시크릿 게이트(서버 라우트만 호출). best-effort 기록용.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.append_sms_log(
  p_secret       text,
  p_kind         text,
  p_to_phone     text default null,
  p_body         text default null,
  p_channel      text default null,
  p_ok           boolean default null,
  p_user_id      uuid default null,
  p_order_id     uuid default null,
  p_template_key text default null,
  p_fail_reason  text default null,
  p_meta         jsonb default null
)
returns void
language plpgsql
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

  insert into public.sms_log
    (user_id, order_id, kind, to_phone, template_key, body, channel, ok, fail_reason, meta)
  values
    (p_user_id, p_order_id, p_kind, p_to_phone, p_template_key, p_body, p_channel, p_ok, p_fail_reason, p_meta);
end;
$$;

revoke all on function public.append_sms_log(text,text,text,text,text,boolean,uuid,uuid,text,text,jsonb) from public;
grant execute on function public.append_sms_log(text,text,text,text,text,boolean,uuid,uuid,text,text,jsonb) to anon, authenticated;
