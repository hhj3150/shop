-- 주문 취소 시 구독 슬롯도 함께 해지 — '취소된 주문인데 구독은 활성'을 구조적으로 없앤다.
--
--   ★ 왜 필요한가 (2026-09 실사고)
--     관리자 화면의 상태 변경('취소')은 orders.status 만 바꾸고 subscription_slots 는
--     그대로 두었다. 그 결과 실제로 이런 슬롯이 남아 있었다.
--       · 손님 마이페이지: 구독 '활성' + '다음 발송 9/7' 로 보인다.
--       · 배송 명단·배송 시트: 주문이 확정류가 아니라 아예 뜨지 않는다 → 우유가 안 간다.
--       · 요일 정원(subscription_day_count): 자리를 계속 차지해 신규 신청이 막힌다.
--     '문자·화면은 온다는데 물건은 안 온다' — 신뢰가 무너지는 전형적인 경로다.
--
--   이 RPC 는 주문 취소와 슬롯 해지를 한 트랜잭션으로 묶는다. 멱등이라 이미 '취소'인
--   주문에 다시 호출하면 남은 슬롯만 정리한다(과거에 생긴 이상 데이터 복구용).
--
--   ⚠ 환불액은 건드리지 않는다. 결제 후 취소의 환불은 금액 판단이 필요해 사람이 처리한다
--     (구독 해지 환불은 회원의 cancel_subscription 이 별도 산식으로 계산한다).
--   ⚠ 연장(재구독) 주문의 취소는 슬롯을 해지하지 않는다. 연장분만 무효가 되고 원구독 회차는
--     계속되어야 하기 때문이다. 총 회차는 '확정된 블록 체인' 합이라 취소 즉시 자동으로 줄어든다.
--
-- 적용: Supabase SQL Editor 에서 이 파일 전체 실행(또는 MCP apply_migration). 멱등.

create or replace function public.admin_cancel_order(p_order_id uuid, p_reason text default null)
returns int              -- 이번 호출로 해지된 슬롯 수
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status  text;
  v_renews  bigint;
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_slots   int  := 0;
  v_reason  text := coalesce(nullif(btrim(p_reason), ''), '주문 취소');
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;

  select status, renews_slot_id into v_status, v_renews
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception '주문을 찾을 수 없습니다.'; end if;

  if v_status <> '취소' then
    update public.orders set status = '취소' where id = p_order_id;
    perform public.log_order_event(
      p_order_id, 'status_change', v_status, '취소', v_reason, null
    );
  end if;

  -- 연장 주문은 슬롯을 해지하지 않는다(원구독은 계속된다).
  if v_renews is not null then
    return 0;
  end if;

  -- 이 주문이 만든 슬롯을 모두 해지 → 요일 자리 반환 + 손님 화면에서 '해지'로 표시된다.
  --   '활성'도 포함한다. 취소된 주문의 배송은 어차피 나가지 않으므로, 활성으로 남겨 두는 것은
  --   손님에게 오지 않을 배송을 약속하는 것과 같다.
  with released as (
    update public.subscription_slots
       set status        = '해지',
           paused        = false,
           paused_at     = null,
           cancel_reason = v_reason,
           cancelled_at  = v_today
     where order_id = p_order_id
       and status <> '해지'
    returning 1
  )
  select count(*)::int into v_slots from released;

  return v_slots;
end;
$$;

grant execute on function public.admin_cancel_order(uuid, text) to authenticated;

-- 검증
--   -- 취소인데 살아 있는 슬롯(0이어야 한다)
--   select count(*) from subscription_slots s join orders o on o.id = s.order_id
--    where o.status = '취소' and s.status <> '해지';
