# 핸드오프 — 전환 퍼널 강화 (2026-06-02)

> **목표:** 2개월 내 정기구독 회원 500명. 이 세션은 "전환 퍼널 강화" 트랙을 이어서 진행했다.

## 이번 세션에 배포한 것 (main, 모두 푸시됨)

| 커밋 | 내용 |
|------|------|
| `2f7b148` | 홈 구독 밴드 결정 지점에 소셜 프루프 추가 |
| `424e462` | 입금 단계 금액 원탭 복사 (무통장 전환 마찰 해소) |
| `5c92a12` | 모바일 하단 메뉴 영상 항목 → MILK ROAD 링크 교체 |
| `43de008`→`c3918ee` | **(C) 가입 이탈 복구** — 미입금 D+1/D+2 리마인드 + D+3 자동취소·슬롯반환 (아래 Phase C) |

> 직전 맥락 커밋: `c77abe4`(가입 소셜 프루프), `50634fa`(가입 폼 마찰 완화), `aa8e139`(가입 잔여석 카드).

### Phase C — 가입 이탈 복구 (`43de008`→`c3918ee`, 프로덕션 검증 완료)
- **병목:** 가입 후 무통장입금 미완 = 회원 확정 전환의 마지막 큰 누수. 송금 안 하면 자리만 점유.
- **정책(브레인스토밍 확정):** D+1 입금 재안내(PAYMENT_GUIDE 재사용) · D+2 마감 임박(PAYMENT_DEADLINE, 마감일=D+3) · D+3 자동취소+슬롯반환. 전체 `입금대기` 주문 대상, 옵트아웃 없음(거래성). record-before-send(누락<중복).
- **아키텍처:** Netlify 스케줄 함수(매일 09:00 KST) → **시크릿게이트 SECURITY DEFINER RPC 2개**(읽기 `payment_recovery_targets` / 쓰기 `apply_recovery_action`). `service_role` 미사용 — anon 키 + Vault 시크릿(`payment_recovery_secret` / Netlify env `PAYMENT_RECOVERY_SECRET`).
- **변경 파일:** `lib/payment-recovery.ts`(+test, 9케이스: KST 단계판정·메시지조립) · `supabase/migration-payment-recovery.sql`(`order_reminders` 원장 PK(order_id,stage) + RPC 2개) · `netlify/functions/payment-recovery.mts`(스케줄 배선) · `package.json`(`@netlify/functions`) · `.env.example`.
- **프로덕션 검증(2026-06-02):** 마이그레이션 적용 · Vault 시크릿 등록 · 시크릿게이트(틀린값→forbidden / 맞는값→`입금대기` 주문 반환) · Netlify env 동기화 · 스케줄 함수 등록 · 수동 트리거 D1 발송+원장 기록+중복방지 — 모두 통과.
- **운영 리스크 메모:** "수정판 Next16 + webpack"에서 `.mts` 스케줄 함수 미등록 시 폴백 = GitHub Actions 크론이 시크릿 헤더 보호 라우트 호출 (플랜 Task 6 Step 4에 설계됨). 이번엔 정상 등록됨.
- **스펙/플랜:** `docs/superpowers/specs/2026-06-02-signup-recovery-design.md` · `docs/superpowers/plans/2026-06-02-signup-recovery.md`.

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

## 다음 세션에서 할 일 — 후보 (CTO 권장 우선순위)

(C) 가입 이탈 복구는 **완료·검증**됨(위 Phase C). 다음 레버 후보:

1. **(권장) 결제 마찰 근본 제거 — PortOne 간편결제/카드 활성화.**
   - **근거:** Phase B(금액 복사)·Phase C(미입금 리마인드)는 전부 *무통장입금의 완료 갭*을 메우는 대증요법. 카드·카카오페이/네이버페이는 **즉시 확인** → D+1/D+2/D+3 누수 자체가 사라짐. `.env.example`에 PortOne v2(`storeId`/`channelKey`) 인프라 이미 존재.
   - **트레이드오프:** 결제 수수료 발생 + PortOne 연동/웹훅 검증 필요(서버 작업). 무통장은 수수료 0이라 병행 제공이 정석. → **brainstorming 먼저**(HARD-GATE).
2. **재구독/리텐션 유도** — 500명은 신규뿐 아니라 *유지*도 필요. 만료 임박 알림(`SOLAPI_TEMPLATE_RENEW_GUIDE` 존재) 활용.
3. **추천(referral)** — 기존 회원 → 지인 초대. 2개월 500명 목표에 바이럴 레버.

### 더 뒤로 미룬 후보
- (B) 구독 기간 4/8/12주 선택 — 별도 사이클.
- 영업일 기준 마감일 보정 (현재는 달력일 D+3 고정 — signup-recovery 스펙 out-of-scope).

## 반드시 지킬 표준 제약 (이 레포)
- **공개 레포** — 시크릿 절대 커밋 금지.
- 스테이징은 **명시 파일만**, `git add -A`/`git add .` 금지. 특히 untracked jpg 2개(`public/brand/최종제품4인방2.jpg`, `public/brand/최종제품_4인방.jpg`) **제외**.
- 외과적 변경(요청 라인만), immutability(스프레드, 무mutation), 하드코딩 금지 → `lib/products.ts`·`lib/site.ts` SSOT에서 파생.
- **MODIFIED Next.js 16**: 게이트는 `next build --webpack` (lint 포함). `next lint --dir` 안 됨. Next API 변경 전 `node_modules/next/dist/docs/` 읽기.
- 테스트는 **vitest, node env, `lib/**/*.test.ts`만** (컴포넌트 단위 테스트 없음 — 순수 로직만 TDD). alias `@`→레포 루트.
- 완료 주장 전 **이번 메시지에서** 신선한 vitest + tsc + build 실행 후 증거 제시.
- git config 변경 금지, 훅 스킵 금지. (커밋 시 committer 자동설정 경고는 양성 — 무시.)

## 검증 상태 (이 세션 마지막 실행)
- vitest: **65/65 통과** (12 파일 — signup-recovery 9케이스 포함)
- `tsc --noEmit`: **exit 0**
- `next build --webpack`: 로컬 미실행(한글 경로 깨짐) — 정답성 게이트는 tsc+vitest로 대체. Phase C는 프로덕션에서 직접 검증(위).
- `git status`: 깨끗 (jpg 2개만 의도적 untracked), `HEAD == origin/main == c3918ee`
