# 순매출 KPI — 설계

- 날짜: 2026-06-08
- 상태: 승인
- 범위: 관리자 통계(AdminStats)에 환불·해지 차감 후 "순매출" 지표 추가

## 배경

[88810d3] 감사 후속에서 `AdminStats`의 매출 라벨을 "환불·해지 차감 전 총액"으로
명시하고, 실제 순매출 표시는 **환불 데이터 연결이 필요한 별도 작업**으로 분리했다.
이 문서는 그 분리된 1건을 마무리한다.

## 정의

```
순매출 = 확정 총매출
         − 구독해지 환불 합계
         − 완료 제품환불 합계
```

- **확정 총매출**: 기존과 동일. `status ∈ {입금확인, 배송준비, 배송중, 배송완료}` 주문의
  `total_amount` 합. (취소 주문은 애초에 미포함 → 별도 차감 불필요)
- **구독해지 환불 합계**: `subscription_slots` 중 `status='해지'` 행의 `refund_amount` 합.
  (남은 회차 환불액. 관리자 "해지·환불 처리" 명단의 `refundTotal`과 동일 정의)
- **완료 제품환불 합계**: `order_returns` 중 `type='환불' AND status='완료'`의 `amount` 합.
  (교환은 매출 영향 없음 → 제외. 접수·승인 등 미완료 건은 예정액이므로 제외)
- 음수 방지: `netRevenue = max(0, gross − cancelRefunds − returnRefunds)`.

### 차감 시점의 비대칭(의도된 결정)

해지 환불은 `해지` 즉시 전액 차감하고, 제품환불은 `완료` 시에만 차감한다.
해지 슬롯에는 별도의 "송금 완료" 플래그가 없어 기존 `refundTotal`(처리 대기 명단 총액)과
정의를 일치시킨다. 제품환불은 워크플로 상태(접수→승인→완료)가 명확하므로 완료분만 센다.
실수령액에 보수적으로 근접하는 쪽(미완료 해지 환불도 곧 나갈 돈으로 간주)을 택했다.

## 변경 단위

### 1. `lib/revenue.ts` (신규 · 순수함수 · TDD)

작은 순수 함수로 분리해 단위 테스트한다. UI·Supabase 의존 없음.

```ts
cancellationRefundTotal(slots): number      // 해지 슬롯 refund_amount 합
completedReturnRefundTotal(returns): number // type='환불' && status='완료' amount 합
netRevenue(gross, cancelRefunds, returnRefunds): number // max(0, ...)
```

엣지: `refund_amount`/`amount` null·undefined → 0, 빈 배열 → 0, 차감액 > 총매출 → 0.

### 2. `components/AdminStats.tsx`

- prop 추가: `returns: OrderReturn[]`.
- 로컬 `Slot` 타입에 `refund_amount?: number | null` 추가(런타임 객체엔 이미 존재 —
  `slots`는 `select('*')` 결과).
- `lib/revenue.ts`로 순매출 계산, KPI 줄에 **순매출** 카드 1개 신설.
- 캡션 정정: 총액과 순매출(차감 후)의 구분을 한 줄로 명시.
- 요일별·주차별·제품별 차트는 **총매출 기준 그대로 유지**(변경 없음).

### 3. `app/admin/page.tsx`

- 기존 병렬 `load()`에 `loadReturns()` 추가 → `returns` state.
- `<AdminStats … returns={returns} />` 전달.
- **트레이드오프(승인됨)**: `ReturnsPanel`이 자체적으로도 returns를 로딩하므로 같은
  페이지에서 returns가 2회 fetch된다. state 리프팅은 ReturnsPanel의 생성/수정 후
  self-reload까지 건드려 변경 범위가 커지므로, surgical하게 페이지 load 1건 추가로 둔다.

## 검증

- `lib/revenue.test.ts`: 해지만 / 환불만 / 둘 다 / 음수클램프 / 빈배열 / null amount.
- `tsc` 0 에러 + 전체 vitest 통과 후 커밋.

## 비목표(YAGNI)

- 주차별·요일별 순매출 귀속(환불을 발생 주차로 되돌리는 계산) — 과거 수치 변동·복잡도 ↑.
- "송금 완료" 플래그 신설 — 현 데이터 모델 변경 없이 진행.
- 환불 사유별 분석·세금계산서 연동.
