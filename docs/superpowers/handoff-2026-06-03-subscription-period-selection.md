# Session Handoff — 송영신목장 shop

**작성:** 2026-06-03 (Wed) · **브랜치:** main (origin/main 동기화 완료) · **최신 커밋:** `5c4e3fc`

---

## ✅ 이번 세션 완료 — Feature B: 정기구독 기간 선택 (4/8/12주)

- 4주/8주/12주 선택, 할인 10%/12%/15%, 선택 기간 전체 무통장입금 선납, 기본 8주('인기'), 12주('최대 할인').
- 만료/연장 알림은 기존 그대로(D-7·D-3), RPC 본문 무변경(서버 단일 권위라 SQL 함수값만 변경).
- **상태:** tsc exit 0, 테스트 90/90, Netlify 프로덕션 배포 `ready`, 서버 SQL 적용 완료(`period_discount(3)=0.15` 확인).

**관련 커밋:** efa4a66(SQL) · 14ec016(products+test) · 417a5db(cart) · 5c4e3fc(panel+badge) · fada36c/4653d00(spec/plan)

---

## 🔴 사장님 직접 — High 우선순위

### 1. 각 기간 테스트 주문 금액 육안 검증
실제 사이트에서 milk-750(정가 12,000) × 3병 기준 주문 1건씩 넣어 `total_amount` 확인:
| 기간 | 할인 | total_amount |
|---|---|---|
| 4주 | 10% | **145,600** |
| 8주 | 12% | **285,440** |
| 12주 | 15% | **415,200** |
불일치 시 Supabase `order_items.unit_price` / `orders.total_amount` 확인.

### 2. Feature A (재구독 리텐션 알림) 프로덕션 활성화 — 코드 완료, 미활성
1. Netlify env `RENEWAL_REMINDER_SECRET` 설정 (값은 Supabase Vault)
2. 재배포 → secret-gate 통과 확인(함수 로그 '미인증' 에러 없음)
3. 09:00 KST 스케줄 함수 발화 확인 (다음 영업일)
4. 수동 트리거 테스트
5. Solapi `EXPIRE_SOON` 템플릿에 `(광고)` 라벨 추가 (정보통신망법)

---

## 🟡 자동화 / 문서 — Medium (다음 세션 후보)

### 3. package.json `typecheck` 스크립트 추가
- 목적: 매 세션 tsc hang 영구 해결.
- 주의: `/opt/homebrew/opt/node@22/bin/node` 절대경로는 머신 종속 → CI/타 개발자 깨짐. .nvmrc(node@22) 기반 이식성 있는 형태로 작성할 것. (하드코딩 경로 지양 — golden-principles)
- 제안값(검토 후): `"typecheck": "node ./node_modules/typescript/bin/tsc --noEmit"` + .nvmrc/nvm use 전제, 또는 래퍼 스크립트.

### 4. `/tmp/vrun` 테스트 러너 영구화
- 현재 `/tmp/vrun/*.mjs`(loader.mjs, vitest-shim.mjs, run.mjs) 재부팅 시 소실.
- repo `scripts/vitest-runner/`로 이동 + package.json test 스크립트 연결. 변경 범위 커서 신중 검토.

### 5. Stale 문서 갱신 (고객/SEO 노출)
- `docs/superpowers/plans/2026-06-02-geo-discoverability-kakao-share.md` (line 84): FAQ가 아직 "1개월(4회분)… 회원 할인 10%" 고정 표기 → "4주/8주/12주 선택, 10/12/15%"로 갱신.
- `docs/superpowers/plans/2026-06-01-storefront-catalog-binding.md` (~line 29): 히어로 "회원 −10%" → 기간별 10–15% 표기.
- ⚠️ 단, 실제 고객 노출 소스(llms.txt / FAQ 컴포넌트)가 이 plan 문서가 아닐 수 있음 → 라이브 소스부터 확인 후 수정.

---

## 🟢 백로그 (info)

### 6. 재구독 시 원래 기간 승계 (deferred, spec §8 YAGNI)
- 현재 `request_renewal`은 원래 기간 무관하게 4주·10%로 재청구(의도된 정책). 12주@15% 가입자도 갱신 시 4주@10%.
- 향후 "원래 기간으로 갱신" 기능은 보류. 실수로 '버그 수정' 하지 말 것 — 정책임.

### 7. 기간 선택 분포 분석 / 12주 마케팅
- 4/8/12주 노출 시작 → 어떤 기간이 많이 선택되는지 1주 데이터 후 집계 (`SELECT period, COUNT(*) FROM subscription_slots GROUP BY period`).
- 12주 '최대 할인'(15%)을 프리미엄 티어로 포지셔닝 → 500 구독자 목표 전환 레버.

### 8. 신규 기간 버튼 모바일/태블릿 QA
- PurchasePanel `grid-cols-4` 버튼이 360~375px에서 배지+할인 라벨 클리핑/터치타깃(48px) 문제 없는지 실기기 확인.

---

## 🧠 학습 포인트 (아키텍처 기억용)

1. **서버 RPC 단일 권위:** `create_subscription_order`가 `period_discount()`·`p_period*4`로 모든 금액 계산. 만료/환불/알림은 `block_weeks`에서 파생 → 신규 기간 추가가 SQL 함수값 변경만으로 끝남. 돈/계산은 항상 서버 최하층에 변수화, 클라는 표시만.
2. **내부 모델 ↔ 사용자 라벨 브릿지:** 내부 1/2/3(개월) ↔ 사용자 4/8/12(주), `periodWeeks(m)=m*4`. 순수함수 브릿지 + 테스트로 강제.
3. **node25 tsc/vitest hang 트랩(머신 종속):** 글로벌 node v25는 tsc·vitest 무한 hang. `npx tsc`도 shebang이 node25를 잡아 hang. 해결: `/opt/homebrew/opt/node@22/bin/node ./node_modules/typescript/bin/tsc --noEmit` 직접 호출. 테스트는 /tmp/vrun 커스텀 러너(node@22).
4. **재구독 기본요율 정책:** 위 6번 참조.
5. **Surgical change:** 정확히 5파일만 변경, 인접 리팩토링 0 → 리뷰 자명.

---

## 다음 세션 시작 시
- `/sync` (git pull + sync-docs) 후 이 파일 참조.
- 미푸시 없음. 워킹트리 깨끗(추적 안 된 jpg 2개는 의도적 제외 유지).
