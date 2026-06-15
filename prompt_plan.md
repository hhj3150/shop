# 구현 계획: 프리미엄 격상 P2-8 — 가장자리 상태 일관화 (확정·완료 2026-06-16)

> 근거: docs/premium-audit.md P2-8 · CTO/디자인·마케팅총괄 위임 승인

## 목표
빈/에러/가장자리 상태를 "하나의 격"으로 통일(텍스트 나열 → 아이콘+serif+보조).

## 구현
- 신규 `components/EmptyState.tsx`: 원형 gold 아이콘 + serif-kr 제목 + mute 보조 + 액션 슬롯. 기준(후기0) 추출.
- 적용: ProductReviews 후기0(통합)·CartDrawer 빈장바구니(+제품보러가기 CTA)·account 주문없음(+CTA)·PurchasePanel 판매중지 박스.
- 품절/마감: PurchasePanel 정원마감 → gold/8 안내박스+info 아이콘(로직 불변).
- 범위 밖(유지): 주문완료·결제실패(orders/complete), 폼에러, 최소금액 경고.

## 검증 (완료·증거)
- tsc 0 · vitest 539/539 · build 0
- 라이브: 빈 장바구니 드로어 EmptyState 정상(아이콘+serif+CTA, 스크린샷). 동일 컴포넌트라 나머지 동일 격.

## 진행 상태
- [x] EmptyState + 4곳 적용 + 품절/마감 + 검증

## 프리미엄 남은 항목
- P1-3 이미지 아트디렉션(촬영 의존) · P2-7 성능(실측)

---

## 이전 계획 (P2-6 신뢰·프리미엄 단서, 완료·머지 #99, 2026-06-16)

> 근거: docs/premium-audit.md P2-6 · CTO/디자인·마케팅총괄 위임 승인

## 목표
원산지·A2·콜드체인을 텍스트 나열 아닌 시각 배지로, 후기 0 상태를 우아하게. 구매 전환·신뢰 강화.

## 구현
- 신규 `components/TrustBadges.tsx`: 3배지(단일목장 직송·A2/A2 원유 100%·콜드체인 냉장배송) 인라인SVG 아이콘+라벨. 모바일 세로스택/데스크톱 sm:grid-cols-3.
- `app/products/[id]/page.tsx`: 좌측 컬럼 Specs 위(=모바일 구매카드 바로 아래 결정지점)에 `<TrustBadges/>`.
- `components/ProductReviews.tsx`: 후기 0 빈 상태를 별 아이콘+"첫 한 병의 후기를 기다립니다" 절제된 디자인으로.

## 검증 (완료·증거)
- tsc 0 · vitest 539/539 · build 0
- 모바일375: 배지 3개 세로스택·순서(구매카드→배지→Specs)·오버플로0·담기바 정상(스크린샷 확인)
- 데스크톱1280: 배지 sm:grid-cols-3(같은행)·후기 빈상태 렌더·오버플로0 (스크린샷 도구가 스크롤영역 캡처불가→측정 검증)

## 진행 상태
- [x] TrustBadges 컴포넌트 + 제품페이지 배치 + 후기 빈상태 + 검증

## 별도 권고 (미처리)
- 고아 컴포넌트 Provenance·WhyHayMilk·ForWhom 정리(살림/삭제) 결정 필요.

## 프리미엄 남은 항목
- P1-3 이미지 아트디렉션(촬영 의존) · P2-7 성능 · P2-8 가장자리 상태

---

## 이전 계획 (P1.5 데스크톱 스티키 구매카드, 완료·머지 #98, 2026-06-16)

> 근거: docs/premium-audit.md P1-4 Phase3 잔여 · CTO/디자인·마케팅총괄 위임 승인
> 기준선: tsc 0 · vitest 539/539

## 목표
데스크톱(lg+)에서 제품 상세를 2단 구도로 — 우측에 스크롤 따라오는 스티키 구매카드, 좌측에 보조 콘텐츠 — 재구성해 와이드 화면의 휑한 여백을 의도된 구도로 채운다(애플식 sticky buy box). 모바일/태블릿은 현행 세로 흐름 100% 유지(회귀 0).

## 구현 (app/products/[id]/page.tsx 1파일)
- `#configure`~표시사항을 `lg:grid lg:grid-cols-[1fr_400px] lg:items-start lg:gap-12`(max-w-7xl) 컨테이너로 감쌈.
- 구매카드(PurchasePanel): DOM 앞 + `lg:order-last lg:sticky lg:top-24` → 모바일 맨 위(현행), 데스크톱 우측 고정. id=configure·data-swipe-ignore 유지.
- 좌측(`lg:order-first`): Specs(dl) + ProductReviews + 표시사항/영양 섹션. 각 블록은 모바일 자체 max-w/패딩 보존, `lg:mx-0 lg:max-w-none lg:px-0`로 그리드 셀에 맞춤.
- 후기는 풀페이지 폭 대신 좌측 컬럼(~758px)에 둠 — 모바일 DOM 순서 보존 위해(회귀 0 우선). 관련상품은 그리드 밖 풀폭 유지.

## 검증 (완료·증거)
- tsc 0 · vitest 539/539 · next build 0
- 데스크톱 1280: grid display, cols 758px+400px, 패널 position:sticky·top:96 고정(스크롤 후 pin 확인), 좌측 x32/폭758·우측 x838/폭400, 오버플로 0. (프리뷰 스크린샷 도구가 스크롤 중간영역 캡처 불가 → 계산스타일·geometry로 검증)
- 모바일 375: grid display:block·패널 position:static·DOM순서 패널→Specs→후기→표시사항 보존·오버플로0
- 태블릿 768: block·오버플로0

## 진행 상태
- [x] 2단 그리드 셸 + 우측 스티키 구매카드
- [x] 좌측 보조콘텐츠(Specs·후기·표시사항) 이동
- [x] 검증(3 뷰포트 + 테스트 + 빌드)
- 비고: PurchasePanel이 ~1102px로 길어 스티키 이동폭은 큰 모니터에서 더 살아남. 핵심 목표(휑함 해소·2단 구도)는 달성.

## 프리미엄 남은 항목 (이번 범위 아님)
- P1-3 이미지 아트디렉션(촬영 의존) · P2 신뢰단서·성능·가장자리 상태

---

## 이전 계획 (P1-5 모션 일관화, 완료·머지 #97, 2026-06-16)
- @theme default-transition = ease-soft·200ms로 전역 통일 + reduced-motion transition 즉시화
- 담은 항목 하이라이트(cart lastAdded → CartDrawer cart-added) + 토글/수량/삭제/함께담기 active:scale
- 검증: tsc0·vitest539·build0·라이브

## 이전 계획 (P1 구매 동선, 완료·머지 #95)
- 모바일 하단 담기바 + 보조정보 접이식 + FAB겹침 해소. (데스크톱 스티키 카드는 P1.5로 후행 → 이번에 완료)

## 이전 계획 (P0 첫인상, 완료·머지 #94)
- 넛지 지연 등장 + 데스크톱 lg 2단 히어로
