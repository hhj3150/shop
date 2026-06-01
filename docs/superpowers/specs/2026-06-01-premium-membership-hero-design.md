# 프리미엄 회원제 히어로 리디자인 설계

> 작성일 2026-06-01 · 상태: 설계(승인 대기)

## 1. 배경 / 문제

송영신목장은 **하루 500리터 한정 생산 · 선착순 500인 정기구독 회원제**라는 철학을 핵심 가치로 삼는다. 그러나 현재 홈 히어로(`components/Hero.tsx`)는 제품 라인업과 향(香) 카피 중심이라 "한정·지속가능성·회원제"라는 브랜드 본질이 첫 화면에서 전달되지 않는다. 잔여 자리 실시간 표시(`SlotAvailability`)는 페이지 하단 구독 밴드에만 있어, 방문자가 가장 먼저 보는 영역에서 **희소성의 후크**가 빠져 있다.

## 2. 목표

방문자가 첫 화면에서 **① 브랜드 철학(소중한 분께 최상의 우유 + 지속가능한 지구) ② 회원제 한정(500인) ③ 지금 남은 자리(실시간)** 를 즉시 체감하도록 히어로를 애플/파타고니아/테슬라풍 미니멀 프리미엄으로 재구성한다.

### 비목표 (YAGNI)
- **히어로 외 섹션 재구성 안 함** — `ProductShowcase`·`NewsBand`·`SubscriptionBand`·`VisitStore`는 그대로. (사진 1장 교체를 위한 `FarmBand`만 선택적 minor 변경.)
- **서버/DB/마이그레이션 작업 없음** — 카운터는 기존 `getDayCounts()` anon 조회만 사용.
- **구체 철학 콘텐츠를 사이트 내에 새로 만들지 않음** — 외부 브랜드 홈(`a2jerseymilk.com`)으로 연결.
- **단품 구매 경로 변경 없음** — §8 참조.
- SSR/ISR 전환 없음 — 히어로 콘텐츠는 SSG 유지, 카운터만 클라이언트 섬.

## 3. 범위

| 구분 | 파일 | 변경 |
|---|---|---|
| 재작성 | `components/Hero.tsx` | 애플식 미니멀 레이아웃 + 라이브 카운터 + 외부 철학 링크 |
| 신규 | `components/MembershipCounter.tsx` | 히어로용 라이브 "남은 자리" 카운터(밝은 배경) |
| 신규(순수) | `lib/subscriptions.ts`에 `totalRemainingSeats()` 추가 | 잔여 합산 순수 함수(TDD) |
| 리팩터 | `components/SlotAvailability.tsx` | 인라인 합산 → 순수 함수 사용(동작 불변) |
| 선택 minor | `components/FarmBand.tsx` | 철학 사진 1장 교체 |
| 자산 | `public/brand/` | 한글 파일명 → ASCII 사본 추가 |

## 4. 히어로 구성 (`components/Hero.tsx`, SSG)

레이아웃: **near-100vh · 순백 배경 · 넓은 여백**. 좌측(모바일 중앙) 카피 스택 + 우측 제품 비주얼의 2열 그리드(기존 그리드 골격 재사용 가능).

| 영역 | 내용 |
|---|---|
| 로고(소) | 기존 `/brand/heymilk-logo.png` 작게 상단 유지(브랜드 식별) |
| Eyebrow | `LIMITED SUBSCRIPTION · MEMBERS ONLY` — 작게, `tracking` 넓게, `text-gold-deep` |
| 센터 슬로건(h1) | **"소중한 분들에게 최상의 우유를.<br>그리고 지속가능한 지구를."** — `font-serif-kr`, 페이지 위계의 중심 |
| 서브 한 줄 | "하루 500리터만 생산합니다. 더 만들 수 있지만, 그러지 않습니다." — `text-mute` |
| 라이브 카운터 | `<MembershipCounter />` (§5) |
| CTA 기본 | **[ 정기구독 신청하기 ]** → `/signup` (`Link`, 다크 필 버튼) |
| CTA 보조 | **[ 우리의 철학 보기 ]** → `https://www.a2jerseymilk.com` (§7, 새 탭) |
| 제품 비주얼 | `/brand/hero-row-white.jpg`(흰배경 정렬샷), 우측 큼직 + `drop-shadow`. `next/image` `priority` |
| 하단 라인 | `Save Our Soil. Save Us.` — "흙을 지키는 일이 우리를 지키는 일입니다." (작게) |

긴 매니페스토(양보다 가치·소/토양 서사)는 **기존 `SubscriptionBand`·`FarmBand`에 이미 존재**하므로 히어로에 중복 작성하지 않는다.

## 5. 라이브 카운터 설계

### 5.1 순수 로직 (`lib/subscriptions.ts`, TDD)
기존 `SlotAvailability`가 인라인으로 계산하던 잔여 합산을 순수 함수로 추출한다.

```ts
// 다섯 요일 잔여 좌석 합계. 각 요일 remaining()은 max(0, capacity - taken)으로 이미 클램프됨.
export function totalRemainingSeats(counts: DayCounts): number {
  return DELIVERY_DAYS.reduce((sum, d) => sum + remaining(counts[d]), 0);
}
```

- **회원수 산출(컴포넌트 측)**: `membersJoined = SUB_TOTAL_CAP - totalRemainingSeats(counts)`. 이로써 `membersJoined + remaining = 500` 항등식이 항상 성립(대기자 초과분은 remaining 0 클램프로 흡수). 별도 함수 불필요.
- 단위 테스트: 빈 카운트(0석 점유→500 잔여), 부분 점유, 요일 초과(클램프), 전 매진(0 잔여) 분기.

### 5.2 컴포넌트 (`components/MembershipCounter.tsx`, `"use client"`)
- 데이터 패칭은 **`SlotAvailability`와 동일 패턴**(set-state-in-effect 회피): `useEffect` + `alive` 가드 + `getDayCounts().then(setCounts).catch(()=>{})`.
- 표시:
  - 로딩 전: 잔잔한 스켈레톤(또는 `—`).
  - 정상: "**500**분 중 **{membersJoined}**분과 함께 · 남은 자리 **{remaining}**" — 남은 자리 숫자를 `gold-foil`/`tabular-nums`로 강조.
  - 매진(`remaining === 0`): "이번 시즌 마감 · 대기 등록으로 모십니다" 문구로 전환.
  - 에러/환경변수 미설정: 카운터만 숨기고(또는 `—`) 히어로 나머지는 정상.
- 밝은(순백) 히어로 배경에 맞춘 스타일. `SlotAvailability`(다크 배경)와 **표현은 분리**, 데이터/순수 로직만 공유.

## 6. 사진 자산

사용자가 `public/brand/`에 추가한 원본:
- `최종제품4인방2.jpg` = **순백 배경 플랫 정렬샷** → 히어로 메인 비주얼
- `최종제품_4인방.jpg` = **돌단 그린 에디토리얼샷** → 철학(FarmBand)

**ASCII 사본 추가**(수정된 Next 16 이미지 최적화 경로의 한글 인코딩 리스크 회피): 원본은 보존하고 빌드에서 참조할 사본을 만든다.
- `cp 최종제품4인방2.jpg hero-row-white.jpg`
- `cp 최종제품_4인방.jpg story-podium.jpg`

`next/image`는 각 자산의 실제(intrinsic) 가로·세로를 `width`/`height`로 지정한다(구현 시 파일에서 확인).

## 7. 외부 철학 링크

보조 CTA "우리의 철학 보기"는 외부 브랜드 홈으로 연결한다.
- `href="https://www.a2jerseymilk.com"`, `target="_blank"`, `rel="noopener noreferrer"`(보안: 탭내빙 방지).
- 외부 이동 접근성 표기(스크린리더용 "새 창" 보조 텍스트 또는 `aria-label`).
- 일반 `<a>` 사용(외부 URL이므로 `next/link` 불필요).

## 8. 단품 구매: 유지 (명시적 비변경)

직전 브레인스토밍의 "단품 비노출" 방향은 **철회**됐다. 회원·게스트 모두 `/order-once` 단품 구매가 가능해야 한다.
- **내비게이션·홈 진입 링크 변경 없음.** `app/order-once`, 게스트 체크아웃, 관련 RPC 모두 그대로.
- 히어로는 회원제를 **강조**하되 단품 경로를 막지 않는다.

## 9. 영향 파일

**신규**: `components/MembershipCounter.tsx`, `lib/subscriptions.test.ts`(또는 기존 테스트에 추가), `public/brand/hero-row-white.jpg`·`story-podium.jpg`(사본).
**수정**: `components/Hero.tsx`(재작성), `lib/subscriptions.ts`(`totalRemainingSeats` 추가), `components/SlotAvailability.tsx`(순수 함수 사용), `components/FarmBand.tsx`(선택: 이미지 교체).

## 10. 테스트 / 검증

- **단위(TDD)**: `totalRemainingSeats` — 빈/부분/초과클램프/매진 분기.
- **회귀**: `SlotAvailability` 리팩터 후 표시 동작 불변(잔여 합계 동일).
- **수동/통합**: 히어로 첫 화면에 슬로건·카운터·CTA 노출. 카운터가 `getDayCounts` 값으로 "N분 함께 · 남은 X" 표기. 매진 시 마감 문구. 보조 CTA가 새 탭으로 `a2jerseymilk.com` 이동. 단품(`/order-once`) 여전히 접근 가능.
- **빌드 게이트**: `rm -rf .next && npx vitest run && npx tsc --noEmit && npx next build` (히어로 SSG 유지 확인) + 변경 파일 eslint 0(신규 위반 없음).
- 구현 전 `node_modules/next/dist/docs/`에서 클라이언트 컴포넌트 ↔ SSG 경계·`next/image` 사용법 확인(AGENTS.md).

## 11. 리스크

- **카운터 0 표시 깜빡임**: 로드 전 스켈레톤/`—`로 완화. 회원수는 `500 - 잔여`로 도출해 항등식 보장.
- **한글 파일명**: ASCII 사본으로 회피(§6).
- **DRY 회귀**: `SlotAvailability` 리팩터가 표시값을 바꾸지 않도록 순수 함수 추출 + 회귀 확인.
- **외부 링크 신뢰**: 사용자 소유 브랜드 도메인. `rel="noopener noreferrer"`로 탭내빙 차단.
