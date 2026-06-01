# 핸드오프 — 전환 퍼널 강화 (2026-06-02)

> **목표:** 2개월 내 정기구독 회원 500명. 이 세션은 "전환 퍼널 강화" 트랙을 이어서 진행했다.

## 이번 세션에 배포한 것 (main, 모두 푸시됨)

| 커밋 | 내용 |
|------|------|
| `2f7b148` | 홈 구독 밴드 결정 지점에 소셜 프루프 추가 |
| `424e462` | 입금 단계 금액 원탭 복사 (무통장 전환 마찰 해소) |

> 직전 맥락 커밋: `c77abe4`(가입 소셜 프루프), `50634fa`(가입 폼 마찰 완화), `aa8e139`(가입 잔여석 카드).

### Phase B — 입금 전환 (`424e462`)
- **병목:** 가입은 끝나도 무통장입금을 송금해야 회원 자리가 확정. 완료 페이지에서 계좌번호는 복사됐지만 **금액은 손입력** → 금액 오기 = 입금-확인 지연.
- **변경 파일:**
  - `lib/deposit-guidance.ts` — `depositAmountDigits()` 순수 함수 (소수 반올림, 0·NaN·Infinity→"")
  - `lib/deposit-guidance.test.ts` — 3 케이스 (TDD, RED→GREEN 확인)
  - `components/CopyAmount.tsx` — 금액 표시 + "금액 복사"(숫자만) 버튼, 계좌 복사와 동일 UI
  - `app/orders/complete/page.tsx` — 단품·구독 두 입금 블록의 금액을 `<CopyAmount>`로 교체

### Phase A — 홈 결정 지점 소셜 프루프 (`2f7b148`)
- **병목:** 퍼널 최상단 홈 구독 밴드(`SubscriptionBand`)는 희소성(`SlotAvailability`)만 있고 회원 후기가 없었음.
- **변경 파일:**
  - `components/SocialProof.tsx` — `variant: "light" | "dark"` 추가 (기본 light → 가입 페이지 **무변경**, 하위호환). `THEME` immutable 룩업으로 기존 색 토큰만 조합, 새 색 없음. 후기 0개면 자동 비표시.
  - `components/SubscriptionBand.tsx` — 잔여석 카드 아래 `<SocialProof variant="dark" />` 배선.

## 현재 퍼널 신뢰 신호 (전 구간 일관)
히어로(잔여석·워드마크) → 홈 구독 밴드(희소성 **+ 후기**) → 가입(잔여석·후기·폼 마찰 완화·비번 토글) → 입금(계좌·**금액** 원탭 복사)

## 다음 세션에서 할 일 — (C) 가입 이탈 복구 (권장 진입점)
- **무엇:** 가입은 됐으나 입금 미완 회원에게 리마인드. → 회원 확정 전환율의 마지막 큰 누수 지점.
- **이미 있는 인프라:** `lib/notify.ts`에 `order_received` / `renewal_guide` / `payment_confirmed` 종류 존재. 서버 라우트 `app/api/notify` 사용.
- **왜 새 세션:** 이건 단순 UI가 아니라 **백엔드(서버 Route·스케줄)와 정책(리마인드 주기·문구·횟수)** 결정이 필요한 새 기능. golden-principle #9(HARD-GATE: 설계 먼저) 적용 → **brainstorming 스킬로 시작**할 것.
- **열어볼 질문:** 리마인드 트리거(가입 후 N시간 미입금?), 채널(문자만?), 횟수·간격, 옵트아웃, 입금 확인 상태를 어디서 읽는가(주문 테이블/뷰).
- **데이터 위치 참고:** 주문/입금 상태는 Supabase. `subscription_day_count` 뷰, `lib/cart.tsx`(요일·라벨), `lib/site.ts`(`DEPOSIT`) 참조.

### 더 뒤로 미룬 후보
- (B) 구독 기간 4/8/12주 선택 — 별도 사이클.

## 반드시 지킬 표준 제약 (이 레포)
- **공개 레포** — 시크릿 절대 커밋 금지.
- 스테이징은 **명시 파일만**, `git add -A`/`git add .` 금지. 특히 untracked jpg 2개(`public/brand/최종제품4인방2.jpg`, `public/brand/최종제품_4인방.jpg`) **제외**.
- 외과적 변경(요청 라인만), immutability(스프레드, 무mutation), 하드코딩 금지 → `lib/products.ts`·`lib/site.ts` SSOT에서 파생.
- **MODIFIED Next.js 16**: 게이트는 `next build --webpack` (lint 포함). `next lint --dir` 안 됨. Next API 변경 전 `node_modules/next/dist/docs/` 읽기.
- 테스트는 **vitest, node env, `lib/**/*.test.ts`만** (컴포넌트 단위 테스트 없음 — 순수 로직만 TDD). alias `@`→레포 루트.
- 완료 주장 전 **이번 메시지에서** 신선한 vitest + tsc + build 실행 후 증거 제시.
- git config 변경 금지, 훅 스킵 금지. (커밋 시 committer 자동설정 경고는 양성 — 무시.)

## 검증 상태 (이 세션 마지막 실행)
- vitest: **56/56 통과** (11 파일)
- `tsc --noEmit`: **exit 0**
- `next build --webpack`: **exit 0 · Compiled successfully**
- `git status`: 깨끗 (jpg 2개만 의도적 untracked), `HEAD == origin/main == 2f7b148`
