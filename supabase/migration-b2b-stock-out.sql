-- B2B 납품 출고 → 재고 차감. 온라인 배송(stock_ship_out)과 같은 규율로,
--   저장된 거래처 일일 필요량(b2b_demand)을 재고에서 1회만 차감한다.
--
-- 규율: is_admin 게이트 · 행잠금(for update) · 음수재고 차단 · 불변 원장(stock_movements) 기록.
-- 이중차감 방지: b2b_demand.shipped_at 로 이미 출고한 행은 건너뛴다(멱등).
-- 매핑: b2b_demand.product_key('이름 용량') = product_catalog(name||' '||volume).
--       카탈로그에 없는 제품·비활성 거래처 행은 출고하지 않는다.
-- 적용: Supabase SQL Editor 에서 실행.

alter table public.b2b_demand
  add column if not exists shipped_at timestamptz;

create or replace function public.b2b_ship_out(p_demand_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec      record;
  v_stock    int;
  v_new      int;
  v_products int := 0;
  v_qty      int := 0;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if p_demand_date is null then raise exception '날짜가 필요합니다.'; end if;

  -- 활성 거래처 · 카탈로그 매핑되는 미출고 필요량을 제품별 합계로 차감.
  --   order by product_id: stock_adjust/stock_ship_out 와 동일 잠금 순서(교착 방지).
  for v_rec in
    select pc.id as product_id, sum(d.qty)::int as qty
      from public.b2b_demand d
      join public.clients c on c.id = d.client_id and c.active
      join public.product_catalog pc on (pc.name || ' ' || pc.volume) = d.product_key
     where d.demand_date = p_demand_date
       and d.qty > 0
       and d.shipped_at is null
     group by pc.id
     order by pc.id
  loop
    select stock into v_stock from public.product_catalog
      where id = v_rec.product_id for update;
    if not found then continue; end if;
    if v_stock is null then continue; end if;  -- 무제한(재고 미관리) 품목은 차감·기록 안 함

    v_new := v_stock - v_rec.qty;
    if v_new < 0 then
      raise exception '재고 부족: % 현재고 %, 출고 % 불가', v_rec.product_id, v_stock, v_rec.qty;
    end if;
    update public.product_catalog set stock = v_new where id = v_rec.product_id;
    insert into public.stock_movements (product_id, delta, kind, note, created_by)
      values (v_rec.product_id, -v_rec.qty, '출고',
              'B2B ' || to_char(p_demand_date, 'YYYY-MM-DD') || ' 납품 출고', auth.uid());
    v_products := v_products + 1;
    v_qty := v_qty + v_rec.qty;
  end loop;

  -- 대상 행(활성·매핑)을 출고 처리. 미매핑·비활성 행은 미출고로 남긴다.
  update public.b2b_demand d
     set shipped_at = now()
   where d.demand_date = p_demand_date
     and d.qty > 0
     and d.shipped_at is null
     and d.client_id in (select id from public.clients where active)
     and exists (select 1 from public.product_catalog pc
                  where (pc.name || ' ' || pc.volume) = d.product_key);

  return jsonb_build_object('products', v_products, 'qty', v_qty, 'date', p_demand_date);
end;
$$;

grant execute on function public.b2b_ship_out(date) to authenticated;
