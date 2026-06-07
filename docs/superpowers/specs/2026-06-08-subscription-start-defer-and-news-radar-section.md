# 구독 시작일 연기(관리자) + 소식레이더 별도 섹션 — 설계

- 날짜: 2026-06-08
- 상태: 승인
- 범위: 관리자(`app/admin`) 두 가지 개선. 소비자 마이페이지·구독 데이터 모델 변경 없음.

## 배경 / 현황 조사 결과

- 구독 연장: 마이페이지에 이미 있음(`requestRenewal`, 남은회차≤2일 때 노출).
- 연장/변경 시 상품구성 변경: 없음. (사용자 의도 = "연장할 때 상품구성·주기 변경" → 별도 후속 B로 분리, 본 작업 제외.)
- 시작일 연기: 없음. 입금확인 시 `started_at`=첫 배송일로 즉시 시작.
- 소식레이더: 종합관리 탭에 `NewsRadarAdminFeed` 인라인.

## A. 구독 시작일 연기/지정 (관리자 전용)

### 결정
관리자만. (자가 변경 정책·검증이 더 필요한 소비자 셀프서비스는 후속.)

### 메커니즘
`computeSchedule`는 `started_at` 기준으로 모든 배송일을 잡는다. 따라서 `started_at`을
미래의 "그 슬롯 요일" 날짜로 바꾸면 그 전까지 발송이 없고, 그 날부터 시작된다.
F1 수정으로 로스터·생산수요도 정확히 따라온다. 슬롯은 '활성' 유지(자리 점유).

- 관리자가 기준일(예: 8/1) 선택 → `started_at` = **기준일 이후 첫 슬롯요일** 날짜.
- `subscription_slots.started_at` 업데이트(관리자 RLS 허용, 기존 updateStatus 와 동일 경로).
- 쓰기 실패 시 알림(조용한 실패 차단).

### 변경 단위
- `lib/ship-date.ts`(또는 인접): 순수 헬퍼 `firstDeliveryOnOrAfter(deliveryDay, baseISO): string`
  = 기준일(포함) 이후 첫 해당요일 ISO. 기존 `firstSubscriptionDelivery` 재사용. **TDD**.
- `app/admin/page.tsx`: 구독 주문 펼침(드릴다운)에 현재 시작일 + 날짜입력 + [시작일 변경].
  슬롯 없음/해지면 비활성. 변경 후 재조회.

### 비목표
- 변경 알림 SMS(이미 통화 합의), 소비자 셀프 변경, 연장과의 상호작용.

## C. 소식레이더 별도 섹션

- 신규 라우트 `app/admin/news-radar/page.tsx` — `/admin/news` 와 동일한 관리자 가드 +
  뒤로가기 링크, `NewsRadarAdminFeed` 렌더.
- `/admin` 헤더에 "소식 레이더" 링크 추가("소식 전하기" 옆).
- 종합관리 탭에서 `NewsRadarAdminFeed` 및 import 제거.
- 데이터·로직 변경 없음.

## 검증
- A: `firstDeliveryOnOrAfter` 단위 테스트(요일/경계). `tsc`·전체 `vitest`·빌드.
- C: `tsc`·빌드·육안(링크 이동, 종합관리에서 사라짐).

## 후속(B, 별도 설계)
구독 연장 시 상품구성/주기 변경 — 금액 차액·정원·환불 얽혀 별도 spec 필요.
