-- ─────────────────────────────────────────────────────────────
-- 물류 ERP ② 유통기한 임박 경보(경량)
--   stock_movements 입고 행에 유통기한을 스탬프하고, stock_adjust 에 선택 인자 p_expiry 추가.
--   FEFO·배치 잔량 없음. 현재고(stock) 단일값은 모듈 ① 권위값 유지.
--
--   ⚠️ stock_adjust 는 4→5 인자로 바뀐다. 반드시 drop(4인자)→create(5인자)→grant(5인자).
--      · 두 시그니처 공존 시 모듈 ① 4-인자 호출이 PGRST203 으로 실패.
--      · grant 누락 시 permission denied for function stock_adjust.
--   본문은 migration-inventory-ledger.sql 의 stock_adjust 를 그대로 복사 + 유통기한 2줄만 추가.
-- 적용: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- ─────────────────────────────────────────────────────────────

-- 1) 유통기한 컬럼(입고 행에만 의미. NULL=미지정).
alter table public.stock_movements
  add column if not exists expiry_date date;

-- 2) 옛 4-인자 함수 제거(명시 시그니처). 모듈 ① grant 도 함께 사라짐 → 4)에서 재부여.
drop function if exists public.stock_adjust(text, integer, text, text);

-- 3) 5-인자 재생성: 기존 본문 100% 보존 + 유통기한 처리만 추가.
create function public.stock_adjust(
  p_product_id text,
  p_delta      integer,
  p_kind       text,
  p_note       text default null,
  p_expiry     date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock int;
  v_new   int;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_kind not in ('입고','조정','폐기') then
    raise exception '거래 유형이 올바르지 않습니다: %', p_kind;
  end if;
  if p_delta = 0 then raise exception '변동 수량이 0 입니다.'; end if;
  -- 유통기한: 입고일 때만 의미. 이미 지난 날짜로는 입고 불가.
  if p_kind = '입고' and p_expiry is not null and p_expiry < current_date then
    raise exception '이미 만료된 유통기한입니다: %', p_expiry;
  end if;

  -- 현재고 행잠금(동시 차감 직렬화).
  select stock into v_stock from public.product_catalog
    where id = p_product_id for update;
  if not found then raise exception '존재하지 않는 제품입니다: %', p_product_id; end if;
  if v_stock is null then
    raise exception '무제한(재고 미관리) 품목은 조정할 수 없습니다. 먼저 현재고를 설정하세요.';
  end if;

  v_new := v_stock + p_delta;
  if v_new < 0 then
    raise exception '재고 부족: 현재고 % 에서 % 를 적용할 수 없습니다.', v_stock, p_delta;
  end if;

  update public.product_catalog set stock = v_new where id = p_product_id;
  -- expiry_date 는 입고일 때만 저장(다른 유형이 stray expiry 를 보내도 null).
  insert into public.stock_movements (product_id, delta, kind, note, expiry_date, created_by)
    values (p_product_id, p_delta, p_kind,
            nullif(trim(coalesce(p_note,'')),''),
            case when p_kind = '입고' then p_expiry else null end,
            auth.uid());

  return jsonb_build_object('product_id', p_product_id, 'stock', v_new);
end;
$$;

-- 4) 새 시그니처에 grant 재부여(필수 — 누락 시 모듈 ① 포함 전 호출이 permission denied).
grant execute on function public.stock_adjust(text, integer, text, text, date) to authenticated;

-- ── 검증(수동, 롤백판 — 결과를 행으로 반환. 자기 데이터 정리 → 실재고 무변) ──────────
-- create or replace function public._rg_expiry_check()
--   returns table(check_name text, result text, detail text)
-- language plpgsql as $$
-- declare v_admin uuid; v_pid text:='milk-180'; v_cnt int; v_blocked boolean:=false; o_s int; o_sf int;
-- begin
--   select id into v_admin from public.profiles where is_admin limit 1;
--   if v_admin is null then check_name:='준비'; result:='FAIL'; detail:='관리자 없음'; return next; return; end if;
--   perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
--   select stock, safety_stock into o_s, o_sf from public.product_catalog where id=v_pid;
--   update public.product_catalog set stock=10 where id=v_pid;
--
--   -- ① 오버로드 단일성(PGRST203 방지): stock_adjust 는 정확히 1개여야.
--   select count(*) into v_cnt from pg_proc where proname='stock_adjust';
--   check_name:='① 오버로드 1개'; result:=case when v_cnt=1 then 'PASS' else 'FAIL' end; detail:=format('count=%s',v_cnt); return next;
--
--   -- ② grant(authenticated execute) 존재: permission denied 방지.
--   check_name:='② grant'; result:=case when has_function_privilege('authenticated','public.stock_adjust(text,integer,text,text,date)','execute') then 'PASS' else 'FAIL' end; detail:=''; return next;
--
--   -- ③ 4-인자 하위호환(positional 4개 → 5번째 default): 모듈 ① 경로 무손상.
--   perform public.stock_adjust(v_pid, 5, '입고', '4arg');
--   check_name:='③ 4인자 호환'; result:='PASS'; detail:='예외 없음'; return next;
--
--   -- ④ 입고 시 유통기한 저장.
--   perform public.stock_adjust(v_pid, 3, '입고', 'RG유통', current_date + 5);
--   select count(*) into v_cnt from public.stock_movements
--     where product_id=v_pid and note='RG유통' and expiry_date = current_date + 5;
--   check_name:='④ 유통기한 저장'; result:=case when v_cnt=1 then 'PASS' else 'FAIL' end; detail:=format('matched=%s',v_cnt); return next;
--
--   -- ⑤ 만료일자 입고 거부.
--   begin perform public.stock_adjust(v_pid, 1, '입고', 'RG과거', current_date - 1);
--   exception when others then v_blocked:=true; end;
--   check_name:='⑤ 만료일 입고거부'; result:=case when v_blocked then 'PASS' else 'FAIL' end; detail:=''; return next;
--
--   -- 정리(자기가 만든 movement 삭제 + 현재고 원복)
--   delete from public.stock_movements where note in ('4arg','RG유통','RG과거');
--   update public.product_catalog set stock=o_s, safety_stock=o_sf where id=v_pid;
--   return;
-- end $$;
-- select * from public._rg_expiry_check();
-- drop function public._rg_expiry_check();
