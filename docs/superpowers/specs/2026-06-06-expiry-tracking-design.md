# 물류 ERP 모듈 ② — 유통기한 임박 경보 설계(경량)

> 작성일 2026-06-06 · 상태: 설계 승인됨 · 모듈 ① 실시간 재고 원장 위에 얹음
> 결정: (A) 경량 추적 · (B) stock_movements 스탬프 · (D-3) 전 제품 공통 경보

## 현재 상태(갭)
- 모듈 ①로 `stock_movements`(입고/출고/조정/폐기 원장) + `product_catalog.stock`(현재고 권위값) 구축됨.
- **유통기한 개념이 전혀 없음.** 우유·요거트는 신선식품이라 임박·만료를 모르면 폐기·클레임 위험.

## 목표
입고 시 **유통기한을 함께 기록**하고, 제품별 **가장 임박한 유통기한**을 D-3 경보로 띄워 폐기를 줄인다.
FEFO 자동출고·배치별 잔량 추적은 **하지 않는다**(그건 정식 LOT=별도 모듈). 현재고 단일값(stock)은 권위값으로 유지.

## 데이터 모델
```
stock_movements: + expiry_date date  (유통기한, NULL=미지정. 입고 행에만 의미)
                 -- 생산일은 넣지 않음(YAGNI — 경보엔 유통기한이면 충분).
```
RLS·인덱스 변경 없음(모듈 ① stock_movements 정책 그대로).

## RPC (외과적 변경)
`stock_adjust` 에 **선택 5번째 인자 `p_expiry date default null`** 추가. 마이그레이션은 **반드시 아래 3단계**를 모두 수행한다(순서·시그니처 정확히):

1. `drop function public.stock_adjust(text, integer, text, text);` — 옛 4-인자 오버로드를 **명시 시그니처로** 제거.
   · **왜 필수(correctness, 단순 정리 아님):** 4-인자·5-인자가 공존하면, 모듈 ① TS가 보내는 4개 명명인자(`p_product_id,p_delta,p_kind,p_note`) 호출이 5-인자(기본값) 함수로도 만족돼 PostgREST가 **PGRST203 "Could not choose the best candidate function"** 로 실패한다 → 모듈 ① 입출고가 깨짐.
2. `create function public.stock_adjust(p_product_id text, p_delta integer, p_kind text, p_note text, p_expiry date default null) ...` — 5-인자 버전 생성.
   · 본문은 모듈 ① [migration-inventory-ledger.sql](../../../supabase/migration-inventory-ledger.sql) **52–92행 본문을 그대로 복사**하고 **추가만** 한다(외과적): is_admin 게이트·`for update`·음수 차단·무제한(`v_stock is null`) 거부·`nullif(trim(...))` note 정규화 **한 줄도 빠뜨리지 말 것**.
   · 추가분: (a) 입고(`'입고'`)이고 `p_expiry`가 있으면 `p_expiry < current_date` 시 거부('이미 만료된 유통기한'). (b) `insert into stock_movements(...)` 에 `expiry_date` 컬럼 추가 — **입고일 때만 `p_expiry`, 그 외 유형은 null**.
3. `grant execute on function public.stock_adjust(text, integer, text, text, date) to authenticated;` — **새 시그니처에 grant 재부여(누락 시 모듈 ① 포함 전 호출이 `permission denied for function stock_adjust` 로 실패).** 1단계 drop이 옛 grant를 같이 지우므로 이 줄이 없으면 깨진다.

- `stock_ship_out` 은 **건드리지 않음**(출고는 유통기한과 무관, 수량만 차감).
- 모듈 ① TS 래퍼(`lib/inventory-data.ts:87`)가 `stock_adjust`의 **유일한 런타임 호출처**다. 5번째 인자 추가는 이 래퍼에만 선택 파라미터를 더해 반영한다.

## 순수 로직 (lib/inventory.ts 추가, TDD)
- `daysUntil(expiry: string /* 'YYYY-MM-DD' */, today: Date): number` — **KST 달력일 차**(오늘=0, 내일=+1, 지남=음수).
  · 구현은 [renewal-retention.ts](../../../lib/renewal-retention.ts)의 `kstDaysUntil`(UTC+9, `Date.UTC` 에폭 차)을 그대로 따른다 — Netlify(UTC) 실행 시 KST 자정 경계 off-by-one 방지. (모든 제품이 같은 `today` 인스턴스로 비교되도록 호출부에서 `now`를 1회 생성해 주입.)
  · ⚠️ renewal-retention 의 `decideRenewalStage` 는 `d<=0 → none` 규칙이라 **반대**다. 복붙 금지 — expiry 경보는 `daysUntil===0`(오늘 만료)을 **'warning'** 으로 본다.
- `expiryAlert(expiries: string[], today: Date, warnDays = 3): { status, nearest, days }`
  · 반환 형태(모든 status 공통): `status: 'expired'|'warning'|'ok'|'none'`, `nearest: string|null`, `days: number|null`.
  · 호출 전 경계에서 비거나 잘못된 문자열은 걸러 넣는다(빈 배열 허용).
  · 미래분(`daysUntil >= 0`)이 하나라도 있으면 → nearest = 그중 최솟값, days = `daysUntil(nearest)`,
    status = `days <= warnDays ? 'warning' : 'ok'`.  (경계 포함: `days===warnDays` → 'warning'.)
  · 미래분이 없고 지난 것만 있으면 → status='expired', nearest = 가장 최근 지난 날짜, days < 0.
  · 입력이 비면 → `{ status:'none', nearest:null, days:null }`.
  · **TDD 경계 케이스(필수):** `days===0`(warning) · `days===warnDays`(warning) · `days===warnDays+1`(ok) · 전부 과거(expired, nearest=최근 과거) · 빈 배열(none) · KST 자정 경계 off-by-one 없음.

## UI (InventoryPanel 확장 — 모듈 ① 화면 그대로)
- **입고 폼**: 유형이 '입고'일 때만 **유통기한 날짜 입력(선택)** 노출 → `stockAdjust(id, delta, '입고', note, expiry)`.
- **행 배지**: `stock > 0` 관리 품목에만 `expiryAlert` 적용:
  🔴 만료 / 🟠 임박 D-N(유통 M/D) / 표시 없음. *(품절(0)·무제한(null)엔 경보 안 함.)*
- **원장 이력**: 입고 행에 유통기한 작게 표기.
- **상단 요약 칩**: 임박·만료 **제품 수**(배치 수 아님). 모듈 ① `lowCount`(`InventoryPanel.tsx:79`)와 동일하게,
  `managed && stock>0` 이고 status='warning' 인 제품 수(임박) / 'expired' 인 제품 수(만료). 배지와 칩이 항상 일치.

### 데이터 접근 (lib/inventory-data.ts)
- **신규 `loadExpiries(): Promise<Map<string, string[]>>`** — 제품별 유통기한 목록.
  · 쿼리: `stock_movements` where `kind='입고'` and `expiry_date is not null` **and `expiry_date >= current_date - 7`**.
    필터는 **expiry_date 기준**(created_at 아님) — 입고 시점으로 자르면 유통기한 긴 품목의 임박분을 놓침. 하한 −7일은 막 지난 만료까지 잡되 옛 데이터 노이즈는 차단.
- `StockMovement` 타입에 `expiry_date: string | null` 추가 + `loadMovements` select 에 `expiry_date` 추가(원장 이력 표기용). *(이력 표시와 경보 수집은 별개 — 이력은 최근 50건, 경보는 위 전용 쿼리.)*
- `stockAdjust` 래퍼에 선택 `expiry?: string` 파라미터 추가 → `p_expiry` 전달.

## 검증
- 순수 로직 vitest TDD(`daysUntil`·`expiryAlert`: 위 경계 케이스 전부 + KST off-by-one).
- SQL 레드-그린: ① 입고 시 expiry 저장됨 ② **모듈 ① 4-인자 호출 하위호환**(PGRST203·permission denied 둘 다 안 남) ③ 만료일자 입고 거부.
- tsc + vitest 전체 green. 마이그레이션 수동 적용(새 파일, 하단 검증 SQL). **커밋 전 사용자 승인**. 배포=main push→Netlify.

## 비고
- 기존 `stock_adjust`(4-인자 동작)·`stock_ship_out`·스토어프론트·배송 로직 100% 보존(외과적, drop+재생성으로 본문 복사+추가만).
- PUBLIC repo 시크릿 금지. 관리자=public.is_admin().
- 경보는 의도적으로 "가장 임박한 날짜"만 본다(B). "며칠 남은 게 몇 개"는 정식 LOT 모듈의 영역.
- **approach-B 잔여 한계(수용):** `stock>0` 게이팅은 **품절(stock=0) 오탐만** 제거한다. 추적된 배치가 모두 과거 만료인데 현재고가 남아 있으면(예: 만료분을 폐기 처리 안 했거나 미추적 입고) 🔴 만료로 뜬다 — 새 입고나 `폐기` 거래가 들어오면 해소. 배치별 잔량을 안 보는 B의 본질적 한계이며, 정식 LOT 모듈에서 해결.
- 후속 ③입고→출고 플로우·④발주·⑤KPI 는 이 위에 얹는다.
