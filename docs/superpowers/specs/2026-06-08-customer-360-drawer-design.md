# 고객 360 정보 드로어 — 설계

- 작성일: 2026-06-08
- 상태: 승인됨 (브레인스토밍 합의 완료)
- 로드맵: 관리자 ERP 개편 ③ (①송장fix·②IA재배치 완료 후속, PR #38·#39·#40)

## 1. 목적

관리자가 회원/주문 표에서 고객 한 명을 누르면, 그 고객의 전체 맥락(구독 회차·잔여, 주문 이력,
입금, 송장, 영수증, 환불)을 **한 드로어에 모아 본다**. 현재 정보가 탭마다 흩어져 있어, 한 고객을
판단하려면 여러 탭을 오가야 하는 문제를 해소한다.

## 2. 범위

### 포함 (이번 작업)
- **읽기 전용 360 뷰** — 흩어진 정보를 모아서 보여준다.
- 진입점 2곳: `회원·구독` 탭 회원명(기존), `주문·입금` 탭 주문행 고객명(신규).
- 기존 `MemberOrdersModal`을 360 드로어로 **대체**.
- 회원 기준 정보(연락처·주소) **수정 기능 유지** — 잘못된 정보 정정은 "보기"의 일부로 간주.

### 제외 (이번에 하지 않음 — 추후 선별 승격)
- 처리 액션 일절 없음: 입금확인·송장입력·영수증발행·구독정지/해지 등.
  → 자주 쓰는 액션이 확인되면 별도 PR로 1~2개씩 승격.
- per-shipment 송장 한계는 그대로 둔다(`orders.tracking_no` 단일 컬럼 → "최신 송장만").
  스키마·문자·고객조회 전반을 건드리는 별도 작업.
- 추가 헤더 정보(가입일·마케팅 수신동의 등)는 추후 보완 — 이번 구조에 무리 없이 끼울 수 있다.

## 3. 아키텍처

데이터는 이미 `AdminPage` 상태에 전부 로드되어 있다(`orders`, `items`, `slots`, `returns`,
`profiles`). 따라서 데이터 수집이 아니라 **집계·표현** 문제다. 핵심은 집계 로직을 순수 함수로
분리해 `AdminPage`(이미 2101줄)를 더 키우지 않고, 단위 테스트 가능하게 만드는 것이다.

```
lib/customer-360.ts                ← 순수 집계 함수 (TDD 대상, 신규)
  buildCustomer360(input) → Customer360 뷰모델

lib/customer-360.test.ts           ← 단위 테스트 (신규)

components/Customer360Drawer.tsx   ← 표현 전용 드로어 (MemberOrdersModal 대체, 신규)

app/admin/page.tsx                 ← 진입점 2곳 배선 + 드로어 렌더 (수정)
components/MemberOrdersModal.tsx    ← 제거 (대체됨)
```

### 단위 경계
- `lib/customer-360.ts`: **무엇을 하나** — 한 고객의 원자료를 받아 표시용 뷰모델로 집계.
  **어떻게 쓰나** — `buildCustomer360({ userId, orders, items, slots, returns, profile, summary, now })`.
  **의존** — `lib/dispatch-schedule.ts`(회차 계산), 순수 데이터 타입만. React/Supabase 비의존.
- `components/Customer360Drawer.tsx`: **무엇을 하나** — 뷰모델을 받아 오른쪽 드로어로 렌더.
  **어떻게 쓰나** — `<Customer360Drawer data={…} onSaveMember={…} onClose={…} />`.
  **의존** — 뷰모델 타입, `ProfileEditor`. 집계 로직 비의존(받기만 함).
- `AdminPage`: 원자료 보유 → `buildCustomer360` 호출 → 드로어에 전달. 진입점 클릭 핸들러 보유.

## 4. 뷰모델 (Customer360)

```ts
type Customer360 = {
  header: {
    name: string;
    segment: MemberSegment;
    ltv: number; confirmedCount: number; aov: number; recencyDays: number | null;
    profile: ProfileEditValues;  // 연락처·주소 (수정 가능)
  };
  subscriptions: SubLine[];   // 슬롯별
  orders: OrderCard[];        // 최신순
  refunds: RefundLine[];      // 환불 접수 + 슬롯 해지 합본
};

type SubLine = {
  slotId: number;
  weekdayLabel: string;       // 월/화/…
  state: "활성" | "정지" | "완료" | "해지";
  round: number; total: number; remaining: number;  // dispatchScheduleForSlot (now 기준)
  startedAt: string | null;
};

type OrderCard = {
  orderNo: string; orderType: string; status: string;
  totalAmount: number; createdAt: string;
  blockWeeks: number | null;
  items: { productName: string; volume: string; qty: number }[];
  deposit: { paidAt: string | null; payMethod: string | null } | null;
  tracking: { courier: string | null; trackingNo: string | null; shippedAt: string | null } | null;
  receipt: { type: string | null; issued: boolean } | null;
};

type RefundLine = {
  source: "구독해지" | "환불접수";
  label: string;              // 예: "목요일 구독 해지" / 주문번호
  date: string | null;
  amount: number;
};
```

### 집계 규칙
- **subscriptions**: `slots` 중 해당 user의 것. 각 슬롯에 `dispatchScheduleForSlot(slot, blockWeeks, todayISO)`를
  적용해 `round/total/remaining/excluded` 산출. 단 `blockWeeks`는 슬롯 컬럼이 아니라 **슬롯 원주문**의 값이다
  (`orders`에서 `slot.order_id`로 조회한 주문의 `block_weeks`; 기존 CSV 내보내기와 동일 경로). 따라서 `buildCustomer360`
  입력의 `orders`를 원주문 조회원으로 함께 쓴다. 반환 `total`은 함수가 `extended_weeks`를 이미 합산하므로 호출부에서
  다시 더하지 않는다. 상태 라벨은 슬롯 `status`(활성/정지/해지) + 회차소진(`remaining===0`)을 "완료"로 매핑.
- **orders**: 해당 user의 주문 최신순. 각 주문에 인라인 입금/송장/영수증을 원자료 컬럼에서 구성
  (`paid_at`/`pay_method`, `courier`/`tracking_no`/`shipped_at`, `cash_receipt_type`/`cash_receipt_issued`).
  값이 모두 비면 해당 인라인 섹션은 `null`(표시 생략).
- **refunds**: `returns`(loadReturns 결과 중 해당 user 주문) + 슬롯 해지(`status==='해지'` & `refund_amount`)를 합쳐
  날짜 내림차순.
- **header**: 기존 `selectedMemberRow`(memberRows 집계)에서 재사용 — 중복 계산하지 않는다.

## 5. UI

- 오른쪽에서 슬라이드되는 드로어. `max-w-md`, 전체 높이, 세로 스크롤. 배경 딤 클릭·ESC로 닫기(기존 모달 패턴 계승).
- 구조(위→아래): 헤더(이름·등급·요약배지·연락처/주소+정보수정) → 구독 현황 → 주문 이력(입금·송장·영수증 인라인) → 환불·해지.
- 주문 카드: 첫 건 펼침, 나머지 접힘(클릭 시 품목·인라인 표시).
- 빈 섹션: 데이터 없으면 해당 섹션 자체를 생략하거나 "내역 없음" 한 줄.

## 6. 진입점 배선

- `회원·구독` 탭: 기존 `onClick={() => setSelectedMember(m.id)}` 유지.
- `주문·입금` 탭: 주문행 고객명에 클릭 핸들러 추가 → `setSelectedMember(o.user_id)`.
  드로어는 `selectedMember`(user_id) 하나로 구동되므로 두 진입점이 동일 상태를 공유한다.

## 7. 에러 처리 / 엣지 케이스

- 선택된 user의 주문/슬롯/환불이 0건 → 각 섹션 "내역 없음", 드로어는 정상 표시.
- `profiles`에 없는 user_id(주문만 있고 프로필 결손) → 헤더 이름은 `nameByUser` 폴백, 정보수정 비활성.
- 회차 계산 불가(레거시 슬롯, 시작일 결손) → `dispatchScheduleForSlot` 기존 폴백 동작에 위임, 표시는 "회차 미상".
- 환불 합본 시 동일 건 중복 없음을 보장(returns와 슬롯 해지는 출처가 달라 중복되지 않음 — 테스트로 고정).

## 8. 테스트 (TDD)

`lib/customer-360.test.ts` — 순수 집계 함수만 단위 테스트:
- 회차/잔여 계산(진행 중·소진·해지 슬롯).
- 주문 인라인 구성(입금/송장/영수증 일부 결손 시 null 처리).
- 환불 합본(구독해지 + 환불접수, 날짜 정렬).
- 주문 최신순 정렬.
- 빈 데이터(주문/슬롯/환불 0건).

드로어 컴포넌트는 표현부라 단위 테스트 제외. **빌드 게이트 = Netlify `next build`**(타입체크 포함) 통과 후 squash 머지.

## 9. 작업 순서 (증분 = 단일 PR)

1. `lib/customer-360.ts` + 테스트 (RED→GREEN).
2. `components/Customer360Drawer.tsx` 신규.
3. `app/admin/page.tsx` 배선(진입점 2곳) + `MemberOrdersModal` 제거.
4. `next build` 통과 → 커밋 → PR → squash 머지.
