# 관리자 섹션별 리스트 인쇄 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 4개 섹션(배송·생산수요·정산·주문입금)에 "리스트 인쇄" 버튼을 추가해 그 섹션의 현재 리스트만 깔끔히(다중 페이지 포함) 인쇄한다.

**Architecture:** 공용 유틸 `printSection(el)`이 대상 요소의 조상 경로를 따라 형제들을 `print-hidden`(display:none)으로 숨겨 대상 subtree만 정상 흐름에 남긴 뒤 `window.print()`, `afterprint`/타임아웃에 정리. `PrintButton` 컴포넌트가 각 섹션 리스트 컨테이너(ref)를 가리킨다. 전역 print CSS는 admin 페이지의 기존 `<style>` 한 곳을 확장.

**Tech Stack:** TypeScript, React(client), vitest+jsdom. DB/SQL 변경 없음.

**Spec:** `docs/superpowers/specs/2026-06-13-admin-section-print-design.md`

**테스트:** `npx vitest run <파일>` · `npx tsc --noEmit` · `npm run build`

---

## File Structure
- Create `lib/admin-print.ts` — `printSection(el)` 격리 인쇄 유틸.
- Create `lib/admin-print.test.ts` — jsdom 단위테스트.
- Create `components/PrintButton.tsx` — no-print 인쇄 버튼.
- Modify `app/admin/page.tsx` — 기존 `<style>` 확장(print-hidden/print-only); 생산수요 표·주문입금 리스트에 ref+버튼+인쇄헤더.
- Modify `components/DispatchPanel.tsx` — 큐 컨테이너 ref+버튼+인쇄헤더; 송장 input 옆 print-only 텍스트; 체크박스·송장 input·출고열 no-print.
- Modify `components/SettlementPanel.tsx` — 정산표 컨테이너 ref+버튼+인쇄헤더.

---

## Chunk 1: 공용 유틸·버튼·CSS

### Task 1: `lib/admin-print.ts` + 테스트
**Files:** Create `lib/admin-print.ts`, `lib/admin-print.test.ts`; Modify `package.json`(devDep)

⚠ **선행(필수): DOM 테스트 환경.** `vitest.config.ts` 가 `environment: "node"` 라 `document`/`window` 가 없고
jsdom 미설치다. printSection 은 DOM 조작이라 jsdom 이 필요하다.
- [ ] **Step 0: jsdom 설치 + 파일별 환경 지정** — `npm install -D jsdom`. 그리고 테스트 파일 **첫 줄**에
  `// @vitest-environment jsdom` docblock 을 둔다(전역 config 변경 없이 이 파일만 jsdom). 설치 후
  `git add package.json package-lock.json` 는 마지막 Step 5 커밋에 함께 포함.

- [ ] **Step 1: 실패 테스트** — `lib/admin-print.test.ts` (첫 줄 docblock 필수)
```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { printSection } from "./admin-print";

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
  // jsdom 에 print 없음 → 모킹
  (window as unknown as { print: () => void }).print = vi.fn();
});

function build() {
  // body > report > [toolbar(no-print), target > list, sibling]
  document.body.innerHTML = `
    <div id="report">
      <div id="toolbar" class="no-print">tools</div>
      <div id="target"><div id="list">rows</div></div>
      <div id="sibling">other</div>
    </div>
    <div id="outside">nav</div>`;
  return document.getElementById("target") as HTMLElement;
}

describe("printSection", () => {
  it("el null 이면 no-op", () => {
    printSection(null);
    expect((window.print as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(document.body.classList.contains("printing-section")).toBe(false);
  });

  it("조상 경로 형제만 print-hidden, 대상·조상은 제외, body 클래스 추가, print 호출", () => {
    const target = build();
    printSection(target);
    expect(document.getElementById("sibling")!.classList.contains("print-hidden")).toBe(true); // target 의 형제
    expect(document.getElementById("outside")!.classList.contains("print-hidden")).toBe(true);  // #report 의 형제
    expect(document.getElementById("target")!.classList.contains("print-hidden")).toBe(false);
    expect(document.getElementById("report")!.classList.contains("print-hidden")).toBe(false);   // 조상
    expect(document.body.classList.contains("printing-section")).toBe(true);
    expect(window.print as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it("no-print 형제는 건드리지 않음", () => {
    const target = build();
    printSection(target);
    expect(document.getElementById("toolbar")!.classList.contains("print-hidden")).toBe(false);
  });

  it("afterprint 시 모든 클래스 정리", () => {
    const target = build();
    printSection(target);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("printing-section")).toBe(false);
    expect(document.getElementById("sibling")!.classList.contains("print-hidden")).toBe(false);
    expect(document.getElementById("outside")!.classList.contains("print-hidden")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인** `npx vitest run lib/admin-print.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `lib/admin-print.ts`
```ts
// 관리자 화면에서 '대상 리스트만' 인쇄. 대상의 조상 경로를 따라 형제들을 display:none(print-hidden)으로
//   숨겨 대상 subtree 만 정상 흐름에 남긴다(긴 리스트 다중 페이지 정상 분할). afterprint/타임아웃에 정리.
export function printSection(el: HTMLElement | null): void {
  if (!el) return;
  const hidden: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const parent = node.parentElement;
    if (!parent) break;
    for (const sib of Array.from(parent.children)) {
      if (sib === node || !(sib instanceof HTMLElement)) continue;
      if (sib.classList.contains("no-print") || sib.classList.contains("print-hidden")) continue;
      sib.classList.add("print-hidden");
      hidden.push(sib);
    }
    node = parent;
  }
  document.body.classList.add("printing-section");

  let done = false;
  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    if (done) return;
    done = true;
    for (const h of hidden) h.classList.remove("print-hidden");
    document.body.classList.remove("printing-section");
    window.removeEventListener("afterprint", cleanup);
    clearTimeout(timer);
  };
  timer = setTimeout(cleanup, 1000);
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
}
```

- [ ] **Step 4: 통과** `npx vitest run lib/admin-print.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add lib/admin-print.ts lib/admin-print.test.ts package.json package-lock.json && git commit -m "feat: 관리자 섹션 인쇄 격리 유틸 printSection(+jsdom devDep)"`

### Task 2: `components/PrintButton.tsx`
**Files:** Create `components/PrintButton.tsx`

- [ ] **Step 1: 구현**(UI 단순 — 단위테스트 생략, tsc로 확인)
```tsx
"use client";
import type { RefObject } from "react";
import { printSection } from "@/lib/admin-print";

// 섹션 리스트 컨테이너(ref)를 인쇄. no-print 라 인쇄물엔 안 나온다.
export function PrintButton({
  targetRef,
  label = "리스트 인쇄",
}: {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => printSection(targetRef.current)}
      className="no-print rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
    >
      🖨 {label}
    </button>
  );
}
```
- [ ] **Step 2: tsc** `npx tsc --noEmit` → 0.
- [ ] **Step 3: Commit** `git add components/PrintButton.tsx && git commit -m "feat: 인쇄 버튼 컴포넌트"`

### Task 3: 전역 print CSS 확장
**Files:** Modify `app/admin/page.tsx` (기존 `<style>` ~1319)

> 참고: 페이지 레벨 대상(주문·입금 1999, 생산수요 1651)에선 ancestor-walk 가 `#report` 의 형제인
> 이 `<style>` 에도 `print-hidden`(display:none)을 붙이지만, **`<style>` 은 display:none 이어도 CSS 가 그대로
> 적용**되므로 무해하다(이를 "고치려" no-print 등 추가하지 말 것).

- [ ] **Step 1: 수정** — 기존 한 줄 `<style>{`@media print { .no-print { display: none !important; } #report { padding-top: 0 !important; } }`}</style>` 를 아래로 교체:
```tsx
      <style>{`@media print {
        .no-print { display: none !important; }
        #report { padding-top: 0 !important; }
        body.printing-section .print-hidden { display: none !important; }
        .print-only { display: none; }
        body.printing-section .print-only { display: block; }
      }`}</style>
```
- [ ] **Step 2: 빌드** `npx tsc --noEmit && npm run build` → 성공.
- [ ] **Step 3: Commit** `git add app/admin/page.tsx && git commit -m "feat: 섹션 인쇄용 print CSS(print-hidden/print-only)"`

---

## Chunk 2: 4개 섹션 배선

### Task 4: 배송 (DispatchPanel)
**Files:** Modify `components/DispatchPanel.tsx`

배경: 큐 테이블 컨테이너 `<div className="mt-4 overflow-x-auto">`(table 직전), 송장 input(`trackingOf(o)`),
출고 열 버튼, 헤더 체크박스 열. 컴포넌트 상단에 `useRef`, `PrintButton` import.

- [ ] **Step 1: import + ref** — `components/DispatchPanel.tsx:6` 의 react import(`{ useMemo, useState }`)에 **`useRef` 추가**(현재 없음), `import { PrintButton } from "@/components/PrintButton";`. 컴포넌트 본문: `const queueRef = useRef<HTMLDivElement>(null);`
- [ ] **Step 2: 큐 컨테이너 ref + 인쇄헤더** — 큐 테이블을 감싼 **`<div className="mt-4 overflow-x-auto">`(약 1053행 — `min-w-[1080px]` 테이블. ⚠ 904행의 다른 overflow-x-auto 표가 아님)** 에 `ref={queueRef}` 추가. 그 div 맨 위(테이블 직전)에:
```tsx
        <div className="print-only mb-3 text-[15px] font-semibold text-ink">
          배송 리스트 · {new Date().toLocaleDateString("ko-KR")}
        </div>
```
- [ ] **Step 3: 인쇄 버튼** — 큐 섹션 헤더/툴바(예: 발송명단 합계 영역 또는 큐 위)에 `<PrintButton targetRef={queueRef} />` 배치(no-print). 적절한 헤더 위치는 큐 테이블 바로 위 행에 우측 정렬로.
- [ ] **Step 4: 컨트롤 no-print + 송장 텍스트 병행**:
  - 헤더 체크박스 `<th>` 와 각 행 체크박스 `<td>` → `className`에 `no-print` 추가.
  - 송장 `<td>`: input 에 `no-print` 추가 + 그 옆에 `<span className="print-only tabular-nums">{trackingOf(o)}</span>`.
  - '출고' 열 헤더 `<th>` + 각 행 버튼 `<td>` → `no-print`.
- [ ] **Step 5: 검증** `npx tsc --noEmit && npm run build` → 0/성공.
- [ ] **Step 6: Commit** `git add components/DispatchPanel.tsx && git commit -m "feat: 배송 큐 리스트 인쇄(송장 텍스트 병행·컨트롤 제외)"`

### Task 5: 정산 (SettlementPanel)
**Files:** Modify `components/SettlementPanel.tsx`

배경: 제품별 정산 `<table>`(~212) 위에 `<h3>제품별 정산`(~206). 그 표 영역을 감싼 컨테이너 div 가 있음(확인).

- [ ] **Step 1: import + ref** — `SettlementPanel.tsx:7` react import(`{ useEffect, useMemo, useState }`)에 **`useRef` 추가**(현재 없음) + `PrintButton` import. `const tableRef = useRef<HTMLDivElement>(null);`
- [ ] **Step 2: 컨테이너 ref + 인쇄헤더** — '제품별 정산' 표를 감싼 **기존 컨테이너 div(약 205행 `<div className="mt-6 overflow-x-auto rounded-2xl …">`, `<h3>`+table 포함)** 에 `ref={tableRef}`(새 컨테이너 불필요). 그 안 맨 위에 `<div className="print-only mb-3 text-[15px] font-semibold text-ink">정산 · {month}</div>`.
- [ ] **Step 3: 버튼** — 인쇄 버튼은 상단 월 선택/CSV 내보내기 툴바(약 177행) 옆에 `<PrintButton targetRef={tableRef} />`(no-print) 배치. (`<h3>`(206)는 flex 행이 아니라 거기 직접 넣으려면 flex wrapper 필요 — 툴바 쪽이 간단.)
- [ ] **Step 4: 검증** `npx tsc --noEmit && npm run build`.
- [ ] **Step 5: Commit** `git add components/SettlementPanel.tsx && git commit -m "feat: 정산 제품별 표 리스트 인쇄"`

### Task 6: 생산 수요 + 주문·입금 (app/admin/page.tsx)
**Files:** Modify `app/admin/page.tsx`

배경: 생산수요 = 1651 부근 `{tab === "생산·재고" && (<> …요일별·제품별 주간 필요 수량 table… <WeeklyPlanTable/> </>)}` — **fragment 라 ref 불가 → 실제 `<div ref>` 로 감싸야 함**. 주문·입금 리스트 = 1999 `<div className="mt-4 overflow-x-auto">`(행 액션 열 이미 no-print). 둘 다 컴포넌트 함수 상단에 ref 선언.

- [ ] **Step 1: import + ref 선언** — `app/admin/page.tsx:3` 의 react import(`{ Fragment, useCallback, useEffect, useMemo, useState }`)에 **`useRef` 추가**(현재 없음) + `PrintButton` import. 컴포넌트 본문 상단:
  `const demandRef = useRef<HTMLDivElement>(null); const ordersRef = useRef<HTMLDivElement>(null);`
- [ ] **Step 2: 생산수요 — fragment 를 div 로** — `{tab === "생산·재고" && ( … )}` 내부 fragment(`<>…</>`)를 `<div ref={demandRef}> … </div>` 로 교체(WeeklyPlanTable 포함). 맨 위에 인쇄헤더 `<div className="print-only mb-3 text-[15px] font-semibold text-ink">주간 필요 수량 · {new Date().toLocaleDateString("ko-KR")}</div>`. 그 표 제목 행(또는 표 위)에 `<PrintButton targetRef={demandRef} label="수요표 인쇄" />`(no-print). ⚠ ProductionPanel(입력 표)은 대상 아님 — demandRef 는 1651 표 블록만.
- [ ] **Step 3: 주문·입금 리스트 ref + 헤더 + 버튼** — 1999 의 리스트 컨테이너 `<div className="mt-4 overflow-x-auto">` 에 `ref={ordersRef}`. 맨 위 인쇄헤더 `<div className="print-only mb-3 …">주문·입금 · {날짜}</div>`. 1947 부근 섹션 제목/툴바 행에 `<PrintButton targetRef={ordersRef} />`(no-print). 행 액션 열은 이미 no-print(추가 작업 없음 — 확인만).
- [ ] **Step 4: 검증** `npx tsc --noEmit && npm run build` → 0/성공.
- [ ] **Step 5: Commit** `git add app/admin/page.tsx && git commit -m "feat: 생산 수요표·주문입금 리스트 인쇄"`

---

## 완료 기준 (Evidence-Based)
- [ ] `npx vitest run` 전체 PASS(admin-print 신규 포함, 회귀 없음)
- [ ] `npx tsc --noEmit` 0 · `npm run build` 성공
- [ ] **수동 인쇄 미리보기**: ①배송 리스트 한 장에 받는분·주소·구성품·**송장 텍스트** 보이고 체크박스·input·출고버튼 미출력 ②긴 리스트 여러 페이지 분할 ③생산 수요표·정산표·주문리스트 각각 깔끔 ④상단 빈 밴드/다른 탭 내용 없음 ⑤기존 "보고서 출력" 정상
- [ ] PR: spec/plan 링크. SQL 없음.

## 미적용/후속
- 항목당 개별 인쇄(라벨), 배송 로스터·생산 입력표 인쇄 — 범위 밖.
