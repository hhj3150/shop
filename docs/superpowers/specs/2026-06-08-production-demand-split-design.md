# 생산·배송 표 정기/단품 분리 + 해지 과다집계 수정 — 설계

- 날짜: 2026-06-08
- 상태: 승인
- 범위: 관리자 '생산·재고' 화면의 생산 수요 집계 정합성 + 정기/단품 표 분리

## 문제

생산 수요 두 표(요일별 주간 필요수량 / 이번 주 생산·배송 계획)의 정기분은
`matrix`(요일 기반)에서 나온다. `matrix`는 `확정 && !정지`만 거르고 **해지·회차소진
구독을 제외하지 않는다**. 반면 실제 배송 명단 `buildRosterForDate`(SSOT)는
`dispatchScheduleForSlot().excluded`로 해지·회차소진·정지를 모두 제외한다(커밋 4fb28f7).
→ 해지·회차소진 구독이 있으면 생산 계획이 실제 배송보다 과다 집계된다(과잉생산 위험).
WeeklyPlanTable 주석("배송 명단과 동일 규칙")과도 실제 동작이 어긋난다.

추가로 '이번 주 계획'은 정기+단품이 한 표에 합쳐져 있어, 관리자가 일회성 단품과
반복 정기를 구분해 보기 어렵다.

## 결정

1. **SSOT 단일화**: 이번 주 계획의 정기분을 `matrix`가 아닌 `rosterForDate`에서 집계한다.
   roster는 이미 해지·회차소진·정지를 제외하고 `kind`(정기/단품)를 구분한다
   → 버그 수정과 정기/단품 분리가 한 번에 해결된다.
2. **표 구조(승인)**: 요일별 주간 필요수량(정기 템플릿)은 유지하되 **해지 제외**를 추가하고,
   '이번 주 계획'을 「정기 배송(날짜별)」·「단품 배송(날짜별)」 **두 표로 분리**한다.
3. **역할 분담**: 회차소진은 날짜 종속이므로 주간 템플릿(요일 고정)이 아니라 날짜별 정기
   표에서 roster가 정확히 반영한다. 주간 템플릿은 해지·정지만 제외하는 정상상태 뷰로 둔다.

## 변경 단위

### 1. `lib/production-demand.ts` (신규 · 순수 · TDD)

```ts
splitDemandByKind(entries): { 정기: Record<제품키, 수량>, 단품: Record<제품키, 수량> }
```
- roster 엔트리(`DeliveryEntry`)들을 kind별·`"제품명 용량"` 키별 수량으로 집계.
- UI·Supabase 의존 없음. 엣지: 빈 입력→두 빈 객체, 단일 kind, 동일 제품 합산.

### 2. `app/admin/page.tsx`

- `onlineDemandForDate`(matrix 기반) 제거 → **`weekPlanDemandForDate(d)`**: `rosterForDate(d)`를
  `splitDemandByKind`로 분리해 `{정기, 단품}` 반환.
- 요일별 `matrix`: 해지 슬롯 주문 제외 추가(`slotByOrder`에서 `status==='해지'`).
  정지는 기존대로 제외.

### 3. `components/WeeklyPlanTable.tsx`

- props: `weekPlanDemandForDate(d) => {정기, 단품}` 수신.
- 재사용 서브컴포넌트 `DemandTable` 추출(작은 파일 원칙) → 정기·단품 두 표 렌더.
- 각 표는 주 합계>0 제품만 행으로 표시(노이즈 제거). 주 이동(◀▶)은 공통.
- 캡션: 정기=해지·회차소진·정지 제외(배송명단과 동일), 단품=ship_date 기준.

## 검증

- `lib/production-demand.test.ts`: 정기만/단품만/혼합/빈/제품합산.
- 회귀 가드: `정기+단품 제품 합 == rosterForDate 제품 합`(분리가 총량을 바꾸지 않음).
- `tsc` 0 + 전체 vitest + Netlify 빌드.

## 비목표(YAGNI)

- 주간 템플릿에 회차소진 날짜연산 도입(템플릿 성격 흐려짐 — 날짜별 표가 담당).
- 단품을 요일 템플릿에 편입.
