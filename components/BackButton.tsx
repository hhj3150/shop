"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  backFallback,
  canGoBackInSite,
  recordVisit,
  shouldResetOnLoad,
  showBackButton,
} from "@/lib/back-nav";

// 스마트폰 상단 바의 '이전 화면' 버튼 — 규칙은 lib/back-nav.ts.
//   홈 화면에 추가해 앱처럼 쓰면(standalone) 브라우저 뒤로가기 버튼이 없다.

const KEY = "ysf-nav-stack";
let bootedThisLoad = false; // 전체 페이지 로드마다 한 번(모듈은 로드마다 새로 만들어진다)

function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack));
  } catch {
    // 사생활 보호 모드 등 — 기록 없이도 버튼은 목록으로 보낸다.
  }
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  // 주소가 바뀔 때마다 기록한다(첫 로드 포함).
  useEffect(() => {
    let stack = readStack();
    if (!bootedThisLoad) {
      bootedThisLoad = true;
      const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (
        shouldResetOnLoad({
          navigationType: nav?.type,
          referrer: document.referrer,
          origin: window.location.origin,
        })
      ) {
        stack = [];
      }
    }
    writeStack(recordVisit(stack, pathname));
  }, [pathname]);

  if (!showBackButton(pathname)) return null;

  const goBack = () => {
    const stack = readStack();
    if (canGoBackInSite(stack)) {
      router.back();
      return;
    }
    // 앞 화면이 없다(링크로 바로 들어옴) → 지금 화면을 목록으로 '바꿔' 보낸다(replace).
    //   push 로 쌓으면 목록에서 다시 '이전'을 눌렀을 때 방금 보던 글로 되돌아온다.
    writeStack(stack.slice(0, -1));
    router.replace(backFallback(pathname));
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="이전 화면으로"
      className="tap press -ml-1.5 mr-1 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-cream/60 text-ink transition-colors hover:border-gold hover:text-gold md:hidden"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M15 5 8 12l7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
