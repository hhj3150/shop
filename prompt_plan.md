# 구현 계획: 프리미엄 격상 P1-5 — 모션·마이크로인터랙션 일관화 (확정 2026-06-16)

> 근거: docs/premium-audit.md P1-5 · CTO 위임 승인("너가 CTO·너의 권고대로")
> 기준선: tsc 0 · vitest 539/539 (착수 전 확인)

## 목표
"애플급 결" — 모든 상태 전환을 같은 이징·같은 리듬으로 "깎아 만든" 느낌. 갈아엎지 않고 기존 강점(paper/ink/gold, serif-kr, reveal/float/roam 모션) 위에 일관성만 더한다. prefers-reduced-motion 존중. 회귀 0.

## 현황 (소스 점검)
- `--ease-soft: cubic-bezier(0.22,1,0.36,1)` 존재(globals.css:26). keyframe 모션은 모두 이 토큰 사용 + reduced-motion 완비.
- 그러나 **상호작용 전환(담기·수량·요일·탭)은 대부분 맨 `transition-*`** → Tailwind 기본 이징(cubic-bezier(0.4,0,0.2,1)·150ms). `--ease-soft` 쓰는 tsx는 5개뿐.
- CartDrawer조차 패널은 ease-soft, 오버레이는 맨 transition으로 불일치.
- 담기 성공 피드백: 버튼 active:scale + 드로어 열림이 전부. 버튼 자체 성공 모먼트 없음.
- Tailwind v4: `@theme`에서 `--default-transition-timing-function`/`--default-transition-duration` 덮으면 전 사이트 `transition-*` 일괄 통일(theme.css:492-493 기본값 확인).

## Phase 1 — 모션 토큰 단일화 (app/globals.css 1파일)
- `--ease-soft`를 `@theme`로 편입.
- `@theme`에 `--default-transition-timing-function: var(--ease-soft)` · `--default-transition-duration: 200ms`.
- 명시용 듀레이션 스케일: `--dur-fast`(160ms)·`--dur-base`(280ms)·`--dur-slow`(500ms).
- reduced-motion에서 transition도 즉시화(현재 keyframe만 처리) — 전역 1블록, !important 범위 최소.

## Phase 2 — 핵심 인터랙션 손맛 (PurchasePanel.tsx, CartDrawer.tsx)
- 요일·기간·수량·함께담기 토글: 메인 버튼과 동일한 `active:scale` 누름감 통일(이징은 Phase1로 자동).
- 담기 성공 피드백(절제): handleAdd 직후 버튼에 짧은 "✓ 담겼습니다"(~1.2s) 상태. reduced-motion 시 텍스트만. 드로어 열림과 비차단.
- (테스트 가능 로직 = 성공 상태 토글 → 단위 테스트 추가 검토. 이징은 CSS라 build+preview로.)

## Phase 3 — 검증 (증거 기반)
- 착수 전 `npm test` 539/539 확인(완료) → 구현 후 `tsc 0` · `npm test 539/539 유지` · `next build exit 0`
- preview 모바일375/데스크톱1280: 담기/요일/수량 전환 + 성공 피드백 스크린샷
- reduced-motion 에뮬레이션으로 즉시화 확인

## 진행 상태
- [x] Phase 1 — 모션 토큰 단일화(@theme default-transition + dur 스케일 + reduced-motion transition)
- [x] Phase 2 — 인터랙션 손맛(토글·수량·삭제·함께담기 active:scale) + 담은 항목 하이라이트(cart-added)
- [x] Phase 3 — 검증: tsc 0 · vitest 539/539 · build 0 · 라이브(이징 200ms/ease-soft·하이라이트·오버플로0)
- 비고: add()가 드로어를 자동 여는 구조라 "버튼 성공 라벨"은 가려져 무의미 → "방금 담은 항목 하이라이트"로 대체

## 위험
- MEDIUM: @theme 전역 변경이 관리자 포함 전 사이트 적용 → 머지 전 육안 회귀 확인(변화는 "더 부드럽게"라 파손 위험 낮음).
- LOW: 담기 성공 상태 ↔ 드로어 자동열림 타이밍 → 비차단 처리.
- LOW: reduced-motion 전역 transition 즉시화 부작용 → 범위 최소.

## 후속 대기 (이번 범위 아님)
- P1.5 데스크톱 스티키 구매카드(P1-4 Phase 3 잔여) · P1-3 이미지 아트디렉션(촬영 의존) · P2 신뢰·성능·마감

---

## 이전 계획 (P1 — 구매 동선, 완료·머지 #95, 2026-06-16)
- Phase 1 모바일 하단 고정 담기 바(IntersectionObserver, shop:addbar로 FAB 겹침 해소) — 완료
- Phase 2 보조정보 접이식(`<details>`) — 완료
- Phase 3 데스크톱 스티키 구매카드 — 미착수(P1.5로 후행)
- 검증: tsc 0 · vitest 539/539 · 모바일375 오버플로0 · 데스크톱1280 바 미노출

## 이전 계획 (P0 — 첫인상, 완료·머지 #94)
- Phase 1 넛지 지연 등장(스크롤60%/6초 게이트) · Phase 2 데스크톱 lg 2단 히어로 — 완료
