"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  backFallback,
  bootVisitKind,
  canGoBackInSite,
  classifyVisit,
  nextStack,
  pickBackDelta,
  shouldResetOnLoad,
  showBackButton,
} from "@/lib/back-nav";

// 스마트폰 상단 바의 '이전 화면' 버튼 — 규칙은 lib/back-nav.ts.
//   홈 화면에 추가해 앱처럼 쓰면(standalone) 브라우저 뒤로가기 버튼이 없다.
//
//   어디로 돌아갈지:
//     1순위 Navigation API(브라우저의 실제 '같은 사이트' 기록) — 정확하고 사이트 밖으로 나갈 수 없다.
//     2순위 이 탭의 주소 기록(sessionStorage) — Navigation API 가 없는 브라우저용. 덜 세는 쪽으로만 어긋난다.
//     둘 다 '앞 화면 없음'이면 그 화면의 목록으로 replace.

const KEY = "ysf-nav-stack";
const LEN_KEY = "ysf-nav-len"; // 마지막으로 본 history.length — 전체 로드가 push 인지 replace 인지 가리려고

// 전체 페이지 로드마다 새로 만들어지는 모듈 상태(클라이언트 전용 — 서버 렌더에서는 쓰지 않는다).
let booted = false;
let lastLength = 0;
let traversalTo: string | null = null; // popstate 로 도착한 경로(브라우저 뒤로·앞으로)

type NavEntry = { url: string | null };
type NavigationLike = { currentEntry: (NavEntry & { index: number }) | null; entries(): NavEntry[] };

function navigationApi(): NavigationLike | null {
  const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
  return nav && nav.currentEntry && typeof nav.entries === "function" ? nav : null;
}

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
    sessionStorage.setItem(LEN_KEY, String(window.history.length));
  } catch {
    // 사생활 보호 모드 등 — 기록 없이도 버튼은 목록으로 보낸다.
  }
}

function readStoredLength(): number | null {
  try {
    const n = Number(sessionStorage.getItem(LEN_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  const renderedPath = useRef(pathname); // popstate 처리에서 '지금 그려진 화면' 경로 — 아래 효과에서 갱신

  useEffect(() => {
    // popstate(뒤로·앞으로)로 온 이동을 알아 둔다 — push/replace 와 구별하려고.
    //   state 가 없는 기록(맨 <a href="#…">·외부 스크립트가 만든 것)은 Next 가 무시해 주소만 바뀌고
    //   화면이 그대로 남는다 → 그 주소로 다시 맞춰 준다(화면이 헛도는 '이전' 방지).
    const onPop = (e: PopStateEvent) => {
      traversalTo = window.location.pathname;
      if (!e.state && window.location.pathname !== renderedPath.current) {
        router.replace(window.location.pathname + window.location.search + window.location.hash);
      }
    };
    // 뒤로·앞으로 캐시(bfcache)에서 되살아난 페이지 — 모듈 상태가 옛것이라 traverse 로 다시 맞춘다.
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      lastLength = window.history.length;
      writeStack(nextStack(readStack(), window.location.pathname, "traverse"));
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onShow);
    };
  }, [router]);

  // 주소가 바뀔 때마다 기록한다(첫 로드 포함).
  useEffect(() => {
    renderedPath.current = pathname;
    let stack = readStack();
    const traversal = traversalTo === pathname;
    traversalTo = null;
    let kind;
    if (!booted) {
      // 새 문서의 첫 기록 — 지난 문서가 남긴 history.length 와 비교(bootVisitKind).
      booted = true;
      const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      const reset = shouldResetOnLoad({
        navigationType: nav?.type,
        referrer: document.referrer,
        origin: window.location.origin,
      });
      if (reset) stack = [];
      kind = bootVisitKind({
        reset,
        navigationType: nav?.type,
        lengthNow: window.history.length,
        storedLength: readStoredLength(),
      });
    } else {
      kind = classifyVisit({ traversal, lengthBefore: lastLength, lengthNow: window.history.length });
    }
    lastLength = window.history.length;
    writeStack(nextStack(stack, pathname, kind));
  }, [pathname]);

  if (!showBackButton(pathname)) return null;

  const goBack = () => {
    const nav = navigationApi();
    if (nav) {
      const delta = pickBackDelta(nav.entries(), nav.currentEntry!.index);
      if (delta !== null) {
        if (delta === -1) router.back();
        else window.history.go(delta);
        return;
      }
    } else if (canGoBackInSite(readStack())) {
      router.back();
      return;
    }
    // 앞 화면이 없다(링크로 바로 들어옴) → 지금 화면을 목록으로 '바꿔' 보낸다(replace).
    //   push 로 쌓으면 목록에서 다시 '이전'을 눌렀을 때 방금 보던 글로 되돌아온다.
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
