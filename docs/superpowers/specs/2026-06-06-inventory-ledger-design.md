# 물류 ERP 모듈 ① — 실시간 재고 원장(자동차감) 설계

> 작성일 2026-06-06 · 상태: 설계 승인됨 · 차감 시점: (a) 배송 출고
> 물류 ERP 고도화 5모듈 중 1번(이후 ②유통기한·LOT ③입고→출고 플로우 ④발주 ⑤KPI).

## 현재 상태(갭)
- `product_catalog.stock` = 정수 1개(NULL=무제한, 0=품절). `safety_stock` 없음.
- 주문 RPC(create_subscription_order / _create_once_order_core)는 `stock=0`이면 품절 차단만 함
  (migration-storefront-catalog-guard.sql / special-delivery-region.sql).
- **자동 차감·입출고 거래·이력 전혀 없음.** stock은 관리자가 손으로 고치는 수치.

## 목표
입고/출고/조정/폐기가 **거래로 기록**되는 원장 + 실시간 현재고(원장↔현재고 정합) + **배송 출고 시 자동 차감** + 부족 경보.

## 데이터 모델
```
product_catalog: + safety_stock int  (안전재고, NULL=경보 안 함). stock은 현재고 권위값으로 유지.

stock_movements (불변 원장)
  id            uuid pk
  product_id    text → product_catalog(id)
  delta         int   not null        -- +입고/조정, −출고/폐기
  kind          text  check (kind in ('입고','출고','조정','폐기'))
  ref_order_id  uuid  null            -- 출고 시 연결 주문(감사)
  note          text
  created_at    timestamptz default now()
  created_by    uuid                  -- auth.uid()

shipment_log (이중차감 방지)
  id            uuid pk
  order_id      uuid → orders
  ship_date     date  not null        -- 그 주차 발송일
  deducted_at   timestamptz default now()
  unique(order_id, ship_date)         -- 같은 주문·같은 발송일은 1회만 차감
```
RLS: 두 테이블 모두 `is_admin()` 전용(원장은 select admin, 쓰기는 RPC).

## RPC (security definer)
- `stock_adjust(p_product_id, p_delta, p_kind, p_note)` — 관리자 입고/조정/폐기.
  is_admin 검증 → `stock_movements` insert + `product_catalog.stock` 원자적 증감(`for update`).
  음수 재고 방지(조정·출고로 0 미만이면 예외 또는 0 clamp — 정책: 0 미만 차단).
- `stock_ship_out(p_order_id, p_ship_date)` — **배송 출고 확정 시 자동 차감**.
  is_admin 검증 → `shipment_log` insert(unique 충돌 시 '이미 출고됨' 반환, 이중차감 방지)
  → 해당 주문의 order_items 품목별 qty 만큼 `stock_movements`('출고', ref_order_id) + stock 차감.
  품목이 stock 미관리(NULL)면 건너뜀(무제한).
- grant execute to authenticated(내부 is_admin 게이트).

## UI
- **신규 `InventoryPanel`(상품·재고 탭)** — 품목별: 현재고 · 안전재고 · 🔴부족 배지(현재고≤안전재고)
  + [입고]/[조정]/[폐기] 버튼(수량·사유 입력) + 원장 이력(최근 N건).
- **DispatchPanel** — 각 배송 행에 **[출고 확정]** 추가 → `stock_ship_out(order_id, ship_date)` 호출,
  성공 시 재고 차감 + 행에 '출고됨' 표시. 이미 출고된 행은 비활성(이중차감 불가).

## 차감 시점 결정 (승인됨)
**(a) 배송 출고 시.** 구독 1주문=N주 배송이라 주문 단위 차감은 과차감 → **발송일(주차) 단위로 1회씩** 차감(shipment_log unique로 보장).

## 검증
- 순수 로직(부족 판정·차감 계산) TDD(vitest).
- SQL 레드-그린: 이중 출고 시 차감 1회만, 음수재고 차단, 동시성(for update) 확인.
- tsc + vitest 전체 green. 마이그레이션 수동 적용(새 파일). 커밋 전 사용자 승인.

## 비고
- 기존 품절 차단(stock=0)·스토어프론트 로직 100% 보존(외과적).
- PUBLIC repo 시크릿 금지. 관리자=public.is_admin().
- ②~⑤ 모듈은 이 원장 위에 얹는다(LOT은 movements에 lot/expiry 확장, 입고→출고는 이 플로우 확장).
