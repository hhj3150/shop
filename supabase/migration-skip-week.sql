-- 정기구독 '이번 주 건너뛰기' (Skip a week) — 원탭으로 다음 배송 1회만 미루기.
--
-- 배경(리텐션): 신선식품 주간배송의 1번 이탈 사유는 "마시는 속도보다 빨리 쌓인다"이다.
--   해지로 가기 전에 '이번 주만 쉬어가기'를 원탭으로 주면 하드 이탈을 크게 줄인다.
--
-- 설계(안전): 검증된 일시정지(pause) 수학을 그대로 재사용한다 — computeSchedule 은 손대지 않는다.
--   건너뛰기 = '다음 배송일까지의 1주 자동재개 일시정지'. 재개 시 paused_days 에 정확히 7일을
--   적립해 총 배송 회차는 보존하고 종료 예정일만 1주 뒤로 민다(기존 일시정지와 동일 의미).
--   ※ paused_days 에 즉시 +7 하지 않는 이유: 균일 시프트는 '직전에 이미 배송된 회차'까지
--     미래로 밀어 재배송 사고를 낸다(computeSchedule 은 날짜로 delivered 를 재계산). 그래서
--     실제 일시정지 구간이 흐른 뒤(자동재개) 7일을 적립하는 방식만 안전하다.
--
-- 적용: Supabase SQL Editor 에서 위에서 아래로 한 번 실행(멱등). 자동재개는 netlify cron
--   (netlify/functions/skip-resume.mts)이 매일 auto_resume_skips 를 호출해 처리한다.

-- ── 1) 스키마: 건너뛰기 자동재개 예정일 ─────────────────────────────
--   skip_resume_on 이 set 이면 'paused=true 인 1주 건너뛰기'이며, 이 날짜에 자동재개된다.
--   (일반 일시정지는 paused=true 이고 skip_resume_on 은 null 로 구분된다.)
alter table public.subscription_slots
  add column if not exists skip_resume_on date;

-- ── 2) 이번 주 건너뛰기 신청(회원 본인) ─────────────────────────────
--   p_skip_date = 건너뛸 '다음 배송 예정일'(클라이언트 computeSchedule 의 nextDate). 미래여야 한다.
--   다음 배송일 '다음 날'에 자동재개되도록 예약 → 그 1회만 발송 제외되고 이후는 1주씩 뒤로.
create or replace function public.skip_next_delivery(p_slot_id bigint, p_skip_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_skip_date is null or p_skip_date <= current_date then
    raise exception '건너뛸 다음 배송일이 올바르지 않습니다.';
  end if;

  update public.subscription_slots
     set paused = true,
         paused_at = current_date,
         skip_resume_on = p_skip_date + 1
   where id = p_slot_id
     and user_id = auth.uid()
     and status = '활성'
     and started_at is not null
     and paused = false          -- 이미 정지/건너뛰기 중이면 불가
     and skip_resume_on is null;
  if not found then
    raise exception '이번 주 건너뛰기를 할 수 있는 활성 구독이 아닙니다.';
  end if;
end;
$$;

-- ── 3) 건너뛰기 되돌리기(회원 본인) — 건너뛸 배송일이 지나기 전에만 ──────
--   적립(7일) 없이 원상복구 → 건너뛰려던 배송이 정상 발송된다.
create or replace function public.cancel_skip(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  update public.subscription_slots
     set paused = false,
         paused_at = null,
         skip_resume_on = null
   where id = p_slot_id
     and user_id = auth.uid()
     and paused = true
     and skip_resume_on is not null
     and skip_resume_on > current_date;  -- 아직 건너뛸 배송 전이라야 되돌리기 가능
  if not found then
    raise exception '되돌릴 수 있는 건너뛰기가 아닙니다(이미 지난 건너뛰기는 되돌릴 수 없습니다).';
  end if;
end;
$$;

-- ── 4) 자동재개(cron) — 건너뛸 배송일이 지난 건너뛰기를 정확히 1주(7일) 적립하고 재개 ──
--   운영 cron 공용 시크릿(Vault: payment_recovery_secret)으로 호출자를 검증한다.
--   7일 고정 적립 = '정확히 1회 건너뜀'(주 1회 cadence) → cron 실행 시각 지연과 무관하게 결정적.
create or replace function public.auto_resume_skips(p_secret text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_count integer;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  update public.subscription_slots
     set paused = false,
         paused_days = paused_days + 7,  -- 정확히 1회분(1주) 적립 → 총 회차 보존, 종료일 +7
         paused_at = null,
         skip_resume_on = null
   where paused = true
     and skip_resume_on is not null
     and skip_resume_on <= current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 5) 일시정지 재개 RPC 방어 보강 — 어떤 재개 경로든 skip_resume_on 을 함께 정리 ──
--   (건너뛰기 상태에서 일반 '배송 재개'가 호출돼도 stale skip_resume_on 이 남지 않게 한다.)
create or replace function public.resume_subscription(p_slot_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscription_slots
     set paused = false,
         paused_days = paused_days + (current_date - paused_at),
         paused_at = null,
         skip_resume_on = null
   where id = p_slot_id
     and user_id = auth.uid()
     and paused = true
     and paused_at is not null;
  if not found then
    raise exception '재개할 수 있는 정지 상태가 아닙니다.';
  end if;
end;
$$;

grant execute on function public.skip_next_delivery(bigint, date) to authenticated;
grant execute on function public.cancel_skip(bigint) to authenticated;
-- auto_resume_skips 는 cron(anon+시크릿)만 호출 — authenticated 광역 grant 불필요하나,
--   기존 cron RPC 와 동일하게 anon 키로 호출되므로 anon 에 실행 권한을 준다(본문에서 시크릿 재검증).
grant execute on function public.auto_resume_skips(text) to anon;
