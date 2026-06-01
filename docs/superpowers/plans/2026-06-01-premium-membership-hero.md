# 프리미엄 회원제 히어로 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 히어로를 애플/파타고니아/테슬라풍 순백 미니멀로 재구성하고, "남은 회원 자리 500" 라이브 카운터를 첫 화면 중앙에 노출한다.

**Architecture:** 잔여 좌석 합산을 순수 함수 `totalRemainingSeats`로 추출(`lib/subscriptions.ts`, TDD)해 기존 `SlotAvailability`(다크)와 신규 `MembershipCounter`(밝은 히어로)가 공유한다. 데이터는 기존 `getDayCounts()`(집계 뷰, 개인정보 없음) anon 조회만 사용하고 서버/DB/마이그레이션 변경은 없다. 히어로는 SSG를 유지하고 카운터만 `"use client"` 섬으로 둔다.

**Tech Stack:** Next.js 16.2.6(`next build --webpack`), React 19, TypeScript 5, Tailwind CSS 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-06-01-premium-membership-hero-design.md`

---

## 도메인 배경 (구현자 필독)

이 코드베이스를 처음 보는 개발자를 위한 핵심 사실:

- **요일별 선착순 정원**: 구독은 월–금 5요일, 각 요일 정원 `SUB_DAY_CAP = 100`석, 5요일 합계 `SUB_TOTAL_CAP = 500`석. 상수는 `lib/products.ts:86-87`.
- **데이터 모델**: `getDayCounts()`(`lib/subscriptions.ts`)는 `DayCounts = Record<DeliveryDay, DayCount>`를 돌려준다. `DayCount = { active, taken, waitlist, capacity }`. `taken`이 정원 점유 수다.
- **잔여 계산**: `remaining(count) = Math.max(0, count.capacity - count.taken)` — 이미 0 이하로 클램프된다(초과 대기분이 음수가 되지 않음).
- **항등식**: `membersJoined = SUB_TOTAL_CAP - totalRemainingSeats(counts)`로 도출하면 `membersJoined + 잔여 = 500`이 항상 성립한다(별도 회원수 함수 불필요).
- **eslint 함정**: `react-hooks/set-state-in-effect` 규칙은 effect 본문에서 **동기 setState**를 에러로 잡는다. 반드시 기존 패턴(`useEffect` + `let alive` 가드 + `getDayCounts().then(setState).catch(()=>{})`)을 따른다. `SlotAvailability.tsx:18-30`이 정확한 표본이다.
- **Next.js는 흔한 버전이 아님**: `AGENTS.md`가 코드 작성 전 `node_modules/next/dist/docs/`의 관련 가이드(클라이언트 컴포넌트 경계, `next/image`)를 읽으라고 명시한다. 새 클라이언트 컴포넌트·이미지 작성 전 확인.
- **색 토큰**(`app/globals.css`): `--color-ink #17120c`, `--color-ink-soft #2b2620`, `--color-mute #8a7e68`, `--color-gold #b89554`, `--color-gold-deep #9a7838`, `--color-cream #fffdf8`. `.gold-foil` 유틸 클래스 존재. Tailwind 4 임의 색 opacity 수식어(`text-mute/80`)는 피하고 정의된 토큰만 쓴다.
- **테스트 패턴**: vitest. `import { describe, it, expect } from "vitest";`, 경로 별칭 `@/lib/...`. 표본: `lib/storefront-merge.test.ts`.

## 파일 구조 (변경 대상)

| 구분 | 파일 | 책임 |
|---|---|---|
| 신규(순수) | `lib/subscriptions.ts`에 `totalRemainingSeats` 추가 | 5요일 잔여 합산 — 단일 진실 공급원 |
| 신규(테스트) | `lib/subscriptions.test.ts` | `totalRemainingSeats` 분기 검증 |
| 리팩터 | `components/SlotAvailability.tsx` | 인라인 reduce → 순수 함수 사용(표시 불변) |
| 신규 | `components/MembershipCounter.tsx` | 히어로용 라이브 카운터(밝은 배경) |
| 재작성 | `components/Hero.tsx` | 애플식 미니멀 + 카운터 + 외부 철학 링크 |
| 선택 | `components/FarmBand.tsx` | 철학 배경 사진 교체 |
| 자산 | `public/brand/` | 한글 파일명 → ASCII 사본 추가 |

---

## Chunk 1: 자산 · 순수 로직 · 리팩터

### Task 1: 사진 ASCII 사본 추가

수정된 Next 16 이미지 최적화 경로에서 한글 파일명 인코딩 리스크를 피하기 위해, 원본은 보존하고 빌드가 참조할 ASCII 사본을 만든다. 원본은 이미 `public/brand/`에 있다(`최종제품4인방2.jpg` 1448×1086 흰배경 정렬샷, `최종제품_4인방.jpg` 1122×1402 돌단 에디토리얼샷).

**Files:**
- Create: `public/brand/hero-row-white.jpg` (복사본)
- Create: `public/brand/story-podium.jpg` (복사본)

- [ ] **Step 1: 사본 생성**

```bash
cp "public/brand/최종제품4인방2.jpg" public/brand/hero-row-white.jpg
cp "public/brand/최종제품_4인방.jpg" public/brand/story-podium.jpg
```

- [ ] **Step 2: 생성·치수 확인**

```bash
ls -la public/brand/hero-row-white.jpg public/brand/story-podium.jpg
sips -g pixelWidth -g pixelHeight public/brand/hero-row-white.jpg | grep pixel
sips -g pixelWidth -g pixelHeight public/brand/story-podium.jpg | grep pixel
```
Expected: 두 파일 존재. `hero-row-white.jpg` = 1448×1086, `story-podium.jpg` = 1122×1402. (이후 Task에서 `next/image` width/height에 이 값을 그대로 쓴다.)

- [ ] **Step 3: Commit**

```bash
git add public/brand/hero-row-white.jpg public/brand/story-podium.jpg
git commit -m "chore: add ASCII-named copies of hero/story brand photos"
```

---

### Task 2: `totalRemainingSeats` 순수 함수 (TDD)

`SlotAvailability`가 인라인으로 하던 5요일 잔여 합산을 순수 함수로 추출한다. 이 함수가 잔여 표시의 단일 진실 공급원이 되며 `MembershipCounter`도 공유한다.

**Files:**
- Create: `lib/subscriptions.test.ts`
- Modify: `lib/subscriptions.ts` (`remaining` 정의 바로 뒤, 현재 51행 다음)

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/subscriptions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { totalRemainingSeats, type DayCounts } from "./subscriptions";
import { DELIVERY_DAYS, type DeliveryDay } from "./cart";

// 요일별 taken만 지정해 DayCounts를 만든다(정원 100 기본). 다른 필드는 합산에 무관.
function makeCounts(
  taken: Partial<Record<DeliveryDay, number>>,
  capacity = 100
): DayCounts {
  return DELIVERY_DAYS.reduce((acc, d) => {
    acc[d] = { active: 0, taken: taken[d] ?? 0, waitlist: 0, capacity };
    return acc;
  }, {} as DayCounts);
}

describe("totalRemainingSeats", () => {
  it("전부 빈 자리 → 500", () => {
    expect(totalRemainingSeats(makeCounts({}))).toBe(500);
  });

  it("부분 점유 → 잔여 합산", () => {
    // 월 30 점유(잔여 70), 화 100 점유(잔여 0), 수·목·금 0(각 100) → 70 + 0 + 300 = 370
    expect(totalRemainingSeats(makeCounts({ mon: 30, tue: 100 }))).toBe(370);
  });

  it("정원 초과 점유는 0으로 클램프", () => {
    // 월 130 점유 → 잔여 0(음수 아님), 나머지 4요일 400 → 400
    expect(totalRemainingSeats(makeCounts({ mon: 130 }))).toBe(400);
  });

  it("전 요일 매진 → 0", () => {
    expect(
      totalRemainingSeats(
        makeCounts({ mon: 100, tue: 100, wed: 100, thu: 100, fri: 100 })
      )
    ).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/subscriptions.test.ts`
Expected: FAIL — `totalRemainingSeats`가 export되지 않음(import 에러 또는 "is not a function").

- [ ] **Step 3: 최소 구현**

`lib/subscriptions.ts`에서 `remaining` 함수 정의(현재 49–51행) **바로 아래**에 추가. `remaining`과 `DELIVERY_DAYS`(3행에서 이미 import됨)를 재사용한다:

```ts
// 다섯 요일 잔여 좌석 합계. 각 요일 remaining()은 max(0, capacity - taken)으로 이미 클램프됨.
// 잔여 표시의 단일 진실 공급원 — SlotAvailability·MembershipCounter가 공유한다.
export function totalRemainingSeats(counts: DayCounts): number {
  return DELIVERY_DAYS.reduce((sum, d) => sum + remaining(counts[d]), 0);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/subscriptions.test.ts`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/subscriptions.ts lib/subscriptions.test.ts
git commit -m "feat: add totalRemainingSeats pure function (TDD)"
```

---

### Task 3: `SlotAvailability` 리팩터 (표시 불변)

기존 인라인 reduce를 방금 만든 순수 함수로 교체한다. **표시 값과 마크업은 변하지 않는다**(같은 합산식의 추출일 뿐). 이건 DRY 회귀 방지가 목적이다.

**Files:**
- Modify: `components/SlotAvailability.tsx:4-9`(import), `:32-34`(합산)

- [ ] **Step 1: import에 `totalRemainingSeats` 추가**

현재(4–9행):
```ts
import {
  getDayCounts,
  remaining,
  isWaitlisted,
  type DayCounts,
} from "@/lib/subscriptions";
```
변경:
```ts
import {
  getDayCounts,
  remaining,
  isWaitlisted,
  totalRemainingSeats,
  type DayCounts,
} from "@/lib/subscriptions";
```
(`remaining`·`isWaitlisted`는 요일별 그리드에서 계속 쓰이므로 남긴다.)

- [ ] **Step 2: 인라인 reduce를 함수 호출로 교체**

현재(32–34행):
```ts
  const totalRemaining = counts
    ? DELIVERY_DAYS.reduce((sum, d) => sum + remaining(counts[d]), 0)
    : null;
```
변경:
```ts
  const totalRemaining = counts ? totalRemainingSeats(counts) : null;
```

- [ ] **Step 3: 타입·린트 확인**

Run: `npx tsc --noEmit && npx eslint components/SlotAvailability.tsx`
Expected: 0 errors. (`DELIVERY_DAYS`는 여전히 51행 그리드에서 사용되므로 unused 경고 없음.)

- [ ] **Step 4: 회귀 확인(테스트)**

Run: `npx vitest run`
Expected: PASS — 기존 테스트 전부 통과. `totalRemainingSeats` 테스트가 합산 동작이 동일함을 보장한다(같은 식).

- [ ] **Step 5: Commit**

```bash
git add components/SlotAvailability.tsx
git commit -m "refactor: SlotAvailability uses totalRemainingSeats (DRY, display unchanged)"
```

---

## Chunk 2: 카운터 · 히어로 · 철학 사진

### Task 4: `MembershipCounter` 컴포넌트 (밝은 배경 라이브 섬)

히어로(순백 배경)에 올릴 라이브 카운터. 데이터/순수 로직은 `SlotAvailability`와 공유하되 **표현(밝은 배경 스타일)은 분리**한다. 작성 전 `node_modules/next/dist/docs/`에서 클라이언트 컴포넌트 경계 가이드를 확인한다(`AGENTS.md`).

**Files:**
- Create: `components/MembershipCounter.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  getDayCounts,
  totalRemainingSeats,
  type DayCounts,
} from "@/lib/subscriptions";
import { SUB_TOTAL_CAP } from "@/lib/products";

// 히어로(순백 배경)에 올리는 실시간 회원 현황.
// "500분 중 N분과 함께 · 남은 자리 X" — 데이터는 SlotAvailability와 동일하게
// subscription_day_count 집계 뷰(개인정보 없음)에서 가져온다.
// 데이터/순수 로직만 공유하고 표현은 분리(밝은 배경).
export function MembershipCounter() {
  const [counts, setCounts] = useState<DayCounts | null>(null);

  // eslint react-hooks/set-state-in-effect 회피: alive 가드 + .then(setState).
  useEffect(() => {
    let alive = true;
    getDayCounts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        // 환경변수 미설정 등 → — 표시로 폴백(SlotAvailability와 동일)
      });
    return () => {
      alive = false;
    };
  }, []);

  const remaining = counts ? totalRemainingSeats(counts) : null;
  const membersJoined = remaining === null ? null : SUB_TOTAL_CAP - remaining;

  // 매진: 로드된 상태에서 잔여 0일 때만(로드 전 null은 매진으로 보지 않음).
  if (remaining === 0) {
    return (
      <p className="text-[14px] leading-relaxed text-ink-soft">
        이번 시즌 마감 ·{" "}
        <span className="text-gold-deep">대기 등록</span>으로 모십니다
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px] leading-relaxed text-mute">
      <span className="font-display tabular-nums text-ink">{SUB_TOTAL_CAP}</span>
      <span>분 중</span>
      <span className="font-display tabular-nums text-ink">
        {membersJoined === null ? "—" : membersJoined}
      </span>
      <span>분과 함께 ·</span>
      <span className="text-ink-soft">남은 자리</span>
      <span className="gold-foil font-display text-[1.15rem] leading-none tabular-nums">
        {remaining === null ? "—" : remaining}
      </span>
    </p>
  );
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npx eslint components/MembershipCounter.tsx`
Expected: 0 errors. 특히 `react-hooks/set-state-in-effect` 위반 없음(alive+.then 패턴).

- [ ] **Step 3: Commit**

```bash
git add components/MembershipCounter.tsx
git commit -m "feat: add MembershipCounter live seats island for hero"
```

---

### Task 5: `Hero.tsx` 재작성 (애플식 미니멀 + 카운터 + 외부 철학 링크)

히어로를 순백 배경·넓은 여백의 미니멀 프리미엄으로 재구성한다. 좌측(모바일 중앙) 카피 스택 + 우측 흰배경 제품 비주얼의 2열 그리드. 히어로 본문은 **SSG 유지**(서버 컴포넌트), 카운터만 클라이언트 섬으로 임포트한다. 긴 매니페스토는 기존 `SubscriptionBand`·`FarmBand`에 있으므로 히어로에 중복 작성하지 않는다.

**Files:**
- Modify: `components/Hero.tsx` (전체 재작성)

- [ ] **Step 1: 전체 재작성**

`components/Hero.tsx` 전체를 아래로 교체:

```tsx
import Image from "next/image";
import Link from "next/link";
import { MembershipCounter } from "./MembershipCounter";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-28 pb-16 sm:px-8 sm:pt-32 lg:min-h-[94svh] lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-20">
        {/* Copy */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Image
            src="/brand/heymilk-logo.png"
            alt="송영신목장 A2 저지 헤이밀크 로고"
            width={800}
            height={800}
            priority
            className="mb-8 w-[104px] max-w-full sm:w-[112px]"
          />

          {/* Eyebrow — 한정·회원제 후크 */}
          <p className="font-display text-[11px] uppercase tracking-[0.34em] text-gold-deep">
            Limited Subscription · Members Only
          </p>

          {/* 센터 슬로건 — 페이지 위계의 중심 */}
          <h1 className="mt-6 max-w-xl text-balance font-serif-kr text-[clamp(1.75rem,4vw,2.9rem)] font-medium leading-[1.32] tracking-[-0.015em] text-ink">
            소중한 분들에게 최상의 우유를.
            <br />
            그리고 지속가능한 지구를.
          </h1>

          {/* 서브 한 줄 */}
          <p className="mt-6 max-w-md text-[14.5px] leading-relaxed text-mute sm:text-[15px]">
            하루 500리터만 생산합니다. 더 만들 수 있지만, 그러지 않습니다.
          </p>

          {/* 라이브 카운터 */}
          <div className="mt-8">
            <MembershipCounter />
          </div>

          {/* CTA */}
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              정기구독 신청하기
            </Link>
            <a
              href="https://www.a2jerseymilk.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="우리의 철학 보기 (새 창에서 열림)"
              className="w-full rounded-full border border-ink/12 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink-soft transition-[transform,border-color,color] duration-300 ease-[var(--ease-soft)] hover:border-gold hover:text-gold-deep active:scale-[0.98] sm:w-auto"
            >
              우리의 철학 보기 →
            </a>
          </div>

          {/* 하단 라인 — Save Our Soil */}
          <p className="mt-10 text-[12.5px] tracking-wide text-mute">
            Save Our Soil. Save Us. — 흙을 지키는 일이 우리를 지키는 일입니다.
          </p>
        </div>

        {/* Product visual — 흰배경 정렬샷(1448×1086) */}
        <div className="flex justify-center">
          <Image
            src="/brand/hero-row-white.jpg"
            alt="송영신목장 A2 저지 헤이밀크 제품 라인업"
            width={1448}
            height={1086}
            priority
            sizes="(max-width:1024px) 86vw, 50vw"
            className="h-auto w-[86%] max-w-[520px] object-contain lg:w-full lg:max-w-[600px]"
          />
        </div>
      </div>
    </section>
  );
}
```

> **시각 주의(수동 검증 항목):** 흰배경 JPG를 흰 섹션에 올리므로 제품이 배경에 자연스럽게 떠 보이도록 `drop-shadow`를 의도적으로 **넣지 않았다**(사각 그림자 박스 방지). 빌드 후 수동 미리보기에서 비주얼이 너무 밋밋하면 `rounded-3xl` 프레임이나 약한 그림자를 추가하는 것은 후속 시각 판단으로 남긴다 — 이 단계에서는 추가하지 않는다.

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npx eslint components/Hero.tsx`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/Hero.tsx
git commit -m "feat: redesign hero with membership counter and philosophy link"
```

---

### Task 6: `FarmBand` 철학 사진 교체 (선택 minor)

스펙 §6에 따라 철학 밴드 배경을 돌단 에디토리얼샷으로 바꾼다. 사진이 바뀌므로 **alt 텍스트도 함께** 사진 내용에 맞게 갱신한다(접근성·정확성). 그라데이션·워터마크·카피는 그대로 둔다.

> **주의:** 기존 `jersey-cow.jpg`는 소 방목 사진이고 신규는 제품 에디토리얼샷이다. 카피("풀과 건초로 기른 100% A2 저지")는 캡션으로 여전히 성립하지만, 소 이미지가 사라지므로 시각 인상이 달라진다. 이건 스펙이 승인한 선택 변경이다. 빌드 후 수동 미리보기에서 인상이 맞지 않으면 이 Task만 되돌릴 수 있다(독립 커밋).

**Files:**
- Modify: `components/FarmBand.tsx:6-12` (배경 `Image`의 `src`·`alt`)

- [ ] **Step 1: 배경 이미지 src·alt 교체**

현재(6–12행):
```tsx
      <Image
        src="/brand/jersey-cow.jpg"
        alt="경기도 안성 송영신목장에서 건초를 먹는 A2 저지 소들"
        fill
        sizes="100vw"
        className="object-cover object-center"
      />
```
변경:
```tsx
      <Image
        src="/brand/story-podium.jpg"
        alt="송영신목장 A2 저지 헤이밀크 제품을 돌단과 푸른 풀 위에 올린 에디토리얼 컷"
        fill
        sizes="100vw"
        className="object-cover object-center"
      />
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npx eslint components/FarmBand.tsx`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add components/FarmBand.tsx
git commit -m "feat: swap FarmBand background to story podium editorial photo"
```

---

## Chunk 3: 통합 검증

### Task 7: 빌드 게이트 + 수동/통합 검증

전체 변경을 합쳐 빌드 게이트를 통과시키고, 히어로 첫 화면·카운터·CTA·단품 경로를 수동 확인한다.

**Files:** (코드 변경 없음 — 검증 전용)

- [ ] **Step 1: 풀 빌드 게이트**

Run:
```bash
rm -rf .next && npx vitest run && npx tsc --noEmit && npm run build
```
Expected: vitest 전체 PASS(신규 4 + 기존), tsc 0 errors, `next build --webpack` 성공(exit 0). 히어로(`/`)가 SSG로 빌드되는지 출력에서 확인(`○ /` 또는 Static 표기 — 카운터는 클라이언트 섬이라 페이지 SSG는 유지된다).

- [ ] **Step 2: 변경 파일 eslint(신규 위반 0)**

Run:
```bash
npx eslint components/Hero.tsx components/MembershipCounter.tsx components/SlotAvailability.tsx components/FarmBand.tsx lib/subscriptions.ts lib/subscriptions.test.ts
```
Expected: 변경 파일에서 새 위반 0. (참고: `lib/cart.tsx:85`, `app/checkout/page.tsx:70`, `app/order-once`의 기존 `set-state-in-effect` 에러는 이 작업과 무관한 선존재 이슈이므로 건드리지 않는다 — 변경 파일 목록에 없음.)

- [ ] **Step 3: 수동 통합 점검(dev 서버)**

Run: `npm run dev` 후 `http://localhost:3000` 확인. 체크리스트:
  - [ ] 첫 화면에 Eyebrow·센터 슬로건·서브·카운터·CTA가 순서대로 보인다.
  - [ ] 카운터가 "500분 중 N분과 함께 · 남은 자리 X"로 실데이터를 표기(로드 전엔 — / 로드 후 숫자). 잔여 0이면 "이번 시즌 마감 · 대기 등록으로 모십니다".
  - [ ] 기본 CTA "정기구독 신청하기" → `/signup` 이동.
  - [ ] 보조 CTA "우리의 철학 보기" → 새 탭으로 `https://www.a2jerseymilk.com` (스크린리더 "새 창에서 열림" aria-label).
  - [ ] 우측 비주얼 = 흰배경 정렬샷, 흰 섹션에서 자연스럽게 보임.
  - [ ] 하단 "Save Our Soil. Save Us." 노출.
  - [ ] 단품 경로 회귀 없음: `/order-once` 직접 접근 가능(네비·홈 진입 링크 변경 안 했으므로 그대로여야 함).
  - [ ] (Task 6 적용 시) 철학 밴드 배경이 돌단 에디토리얼샷으로 바뀌고 시각 인상이 자연스러움.

- [ ] **Step 4: 검증 결과 기록**

빌드 게이트 출력(테스트 통과 수, tsc/build exit, eslint 0)을 근거로 완료를 보고한다. 추측성 "될 것 같다"가 아니라 실행 증거로 보고할 것.

---

## 최종 검토

모든 Task 완료 후 전체 구현에 대해 코드 리뷰 서브에이전트를 디스패치하고, 이상 없으면 superpowers:finishing-a-development-branch로 마무리한다.
