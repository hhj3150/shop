# 관리자 섹션별 리스트 인쇄 — 설계 (v2)

작성일: 2026-06-13

## 1. 배경·목표

관리자가 배송 작업 시 화면을 보며 작업하기 불편하다 — **리스트를 종이로 출력해 보고 배송**하고 싶다.
다른 섹션(생산·정산·주문)도 마찬가지. 현재 종합관리 탭만 `window.print()` "보고서 출력"이 있고
(`@media print { .no-print{display:none} #report{...} }`, `app/admin/page.tsx:1319,1356`), 활성 탭 전체를 인쇄한다.

**목표:** 4개 섹션(**배송**(필수)·생산·재고·정산·세금·주문·입금)에 각각 "리스트 인쇄" 버튼을 추가해,
그 섹션의 **현재 리스트 한 장(필요 시 여러 장)**만 깔끔히 인쇄한다(다른 탭·툴바·버튼·필터·플로팅 제외).

## 2. 현재 구조 (확인 완료)

- **탭은 활성 탭만 마운트**(`tab === "X" && <Panel/>`, page.tsx:1389/1398/1944) → 비활성 섹션은 DOM에 없음
  (인쇄 시 다른 섹션 혼입 위험 없음).
- 한 탭에 **리스트 블록이 여럿일 수 있음**: 배송 = `DispatchPanel`(큐, 1398) + "기간별 배송 명단" 로스터(1695);
  생산·재고 = `ProductionPanel`(입력 표, 1389) + **읽기전용 "요일별·제품별 주간 필요 수량" 표**(page.tsx:1651) + `WeeklyPlanTable`.
- `DispatchPanel`: `queue` 렌더(1053~1203). **송장번호는 `<input value={trackingOf(o)}>` 안에만 존재**
  (1140-1148, 텍스트 렌더 없음). '출고' 열(1150-1177)은 버튼/뱃지.
- `ProductionPanel`(318-401): 제품별 표가 **전부 입력칸**(계획/실제/메모) — 읽기전용 수요 리스트 없음.
- `SettlementPanel`(212-256): 제품별 정산 `<table>` — **읽기전용·정갈**.
- `app/admin/page.tsx`(1999~): 주문·입금 리스트 — 행 액션 열은 이미 개별 `no-print`(2008-2009/2091/2107).
- `Nav`(fixed, no-print 없음), `BottomNav`(fixed), `AdminAssistant`(fixed, no-print 있음). `.no-print` 는 admin print 블록에서만 정의.

## 3. 설계

### 3.1 인쇄 기법 — "대상 subtree만"(조상-형제 display:none 격리, 다중 페이지 안전)
버튼 클릭 시 JS로 대상 요소에서 `body`까지 **조상 경로를 따라 올라가며, 각 단계의 '형제'들을
`print-hidden` 으로 숨김**(조상·대상 subtree 만 남김). `body`에 `printing-section` 추가 후 `window.print()`.
- `display:none`(visibility 아님)으로 숨기므로 대상은 **정상 흐름**에 남아 긴 리스트도 **여러 페이지로 정상 분할**
  (`position:absolute` 미사용 — 다중 페이지 클리핑 회피).
- 정리: `afterprint`(`{once:true}`) + `setTimeout` 폴백에서 `print-hidden`·`printing-section` 제거(둘 중 먼저 실행
  시 다른 하나 취소 — 중복 제거 레이스 방지).
- 기존 "보고서 출력"(클래스 미사용)은 그대로 동작(공존).

전역 `@media print`(기존 `<style>` 한 곳 확장):
```
@media print {
  .no-print { display: none !important; }
  #report { padding-top: 0 !important; }
  body.printing-section .print-hidden { display: none !important; }
  .print-only { display: none; }
  body.printing-section .print-only { display: block; }
}
```

### 3.2 공용 유틸 + 버튼
- `lib/admin-print.ts` (신규): `printSection(el: HTMLElement | null): void`
  - el 없으면 no-op(window.print 미호출).
  - el→body 조상 경로 순회, 각 부모의 자식 중 (대상 경로가 아니고) `no-print` 아닌 형제에 `print-hidden` 추가(추가한 것만 기록).
  - `body.classList.add("printing-section")`; `afterprint`(once)+`setTimeout(…,1000)` cleanup 에서 기록분 제거 + 클래스 제거 + 리스너/타이머 정리.
  - 부수효과만. 테스트: jsdom 에서 형제 `print-hidden` 추가/`afterprint` 후 제거, el null no-op, `window.print=vi.fn()`.
- `components/PrintButton.tsx` (신규, client): props `{ targetRef: RefObject<HTMLElement>, label?: string }`.
  `no-print` 버튼, onClick → `printSection(targetRef.current)`. 기본 label "리스트 인쇄".

### 3.3 섹션별 적용(4곳) — 대상 블록 명시
각 대상 리스트 컨테이너에 `ref` + 상단에 인쇄전용 헤더 `<div className="print-only">{제목} · {날짜}</div>`,
헤더(또는 툴바)에 `<PrintButton targetRef={ref} />`(no-print).
- **배송**(`DispatchPanel`): 대상 = **`queue` 리스트 컨테이너**(로스터·툴바 제외). 행 내 택배사 select·송장 input·
  체크박스·'출고' 열 → `no-print`. **송장번호를 인쇄용 텍스트로 병행**: 송장 input 옆에
  `<span className="print-only">{trackingOf(o)}</span>`(값은 `o.tracking_no` 아닌 **`trackingOf(o)`** — 방금
  붙여넣은 값 반영). 인쇄 헤더 "배송 리스트 · {날짜}". (로스터 '기간별 배송 명단'은 이번 범위 밖.)
- **생산·재고**: 대상 = **page.tsx:1651 읽기전용 "요일별·제품별 주간 필요 수량" 표 영역**(+필요시 `WeeklyPlanTable`).
  ProductionPanel 입력 표는 대상 아님(전부 입력칸이라 부적합). 버튼·ref 는 **page.tsx 그 표 컨테이너**에. 헤더 "주간 필요 수량 · {날짜}".
- **정산·세금**(`SettlementPanel`): 대상 = 제품별 정산 `<table>` 영역(읽기전용·정갈). 헤더 "정산 · {월}".
- **주문·입금**(`app/admin/page.tsx:1999`): 대상 = 주문·입금 리스트 컨테이너. 행 액션 열 이미 `no-print`. 헤더 "주문·입금 · {날짜}".

### 3.4 인쇄 내용 = 화면의 현재 리스트
적용된 날짜·필터·검색 상태 그대로(데이터 재조회·재구성 없음). 비어있으면 빈 리스트 그대로(무해).

## 4. 컴포넌트 경계
- `lib/admin-print.ts`: 인쇄 격리 부수효과(단일 책임).
- `components/PrintButton.tsx`: 버튼 UI + 유틸 호출.
- 전역 print CSS: `app/admin/page.tsx` 기존 `<style>` 한 곳 확장(중복 방지).
- 각 대상: ref + 버튼 + 인쇄헤더 + (배송) 송장 텍스트 병행/컨트롤 no-print(국소 변경).

## 5. 엣지·안전
- **송장 누락 방지(핵심):** 배송 행 송장 input 은 no-print, 대신 `print-only` 텍스트로 `trackingOf(o)` 노출.
- **다중 페이지:** display:none 격리(정상 흐름) → 긴 배송/주문 리스트도 여러 장 정상 분할.
- **클래스 정리:** afterprint(once)+타임아웃, 중복 제거 방지. 스크린(비print) 레이아웃 불변(print 미디어 한정).
- **고정 헤더(Nav/BottomNav):** 조상 경로 밖이라 `print-hidden` 으로 숨겨짐(혹은 조상이면 형제로 숨김). 인쇄전용
  헤더가 리스트 제목을 제공하므로 Nav 미출력 무방. 인쇄 미리보기로 상단 빈 밴드 없음 확인(수동).
- **기존 "보고서 출력" 불변**(클래스 미사용 경로).

## 6. 비범위
- 항목당 개별 인쇄(라벨/포장명세서) — 리스트 전체만.
- 전용 인쇄 테이블 신설(데이터 재구성) — 기존 리스트 DOM 재사용(YAGNI). 단 배송 송장은 텍스트 병행(불가피).
- 배송 '기간별 배송 명단' 로스터·생산 입력 표 인쇄 — 범위 밖(필요 시 후속).
- DB·로직·SQL 변경 없음. CSV 내보내기(기존) 불변.

## 7. 테스트
- `lib/admin-print.test.ts`(jsdom, `window.print=vi.fn()`):
  - el null → window.print 미호출, 클래스 미변경.
  - 중첩 DOM 에서 `printSection(target)` → 조상 경로의 형제만 `print-hidden`, 대상·조상은 제외, body 에 `printing-section`.
  - `no-print` 형제는 건드리지 않음(이미 숨김).
  - `dispatchEvent(new Event("afterprint"))` → 모든 `print-hidden`·`printing-section` 제거.
- 패널/페이지: 타입체크 + 빌드 + **수동 인쇄 미리보기**: ①배송 리스트 한 장에 송장 텍스트 보임·컨트롤 미출력
  ②긴 리스트 여러 페이지 정상 분할 ③생산 주간 수요표·정산표·주문리스트 각각 깔끔히 ④상단 빈 밴드 없음.

## 8. 리스크·완화
- **송장 input 값 미출력:** print-only 텍스트 병행으로 해결(§3.3/§5).
- **다중 페이지 클리핑:** position:absolute 대신 display:none 격리로 정상 흐름 분할(§3.1).
- **잔류 클래스:** afterprint+타임아웃 정리, print 미디어 한정이라 스크린 무영향.
- **대상 오선택:** 버튼이 자기 블록 ref 만 가리킴; 비활성 탭은 미마운트라 혼입 없음.
