"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// 모바일에서 좌우로 밀면 이전/다음 제품으로 이동. 양옆 화살표로도 바로 이동 가능.
export function SwipeNav({
  prevHref,
  nextHref,
  children,
}: {
  prevHref: string;
  nextHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);

  // 화면 양 가장자리에서 시작한 터치는 OS의 뒤로/앞으로 제스처와 겹치므로 무시한다.
  const EDGE_GUARD = 24;

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    if (t.clientX <= EDGE_GUARD || t.clientX >= window.innerWidth - EDGE_GUARD) {
      start.current = null;
      return;
    }
    start.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e: TouchEvent) {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    start.current = null;
    // 가로 이동이 충분하고 세로 스크롤보다 우세할 때만 동작.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    router.push(dx < 0 ? nextHref : prevHref);
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}

      {/* 모바일 전용 좌우 이동 화살표 */}
      <Link
        href={prevHref}
        aria-label="이전 제품"
        className="fixed left-2 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-cream/85 text-ink-soft shadow-sm backdrop-blur-sm transition-transform active:scale-90 md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <Link
        href={nextHref}
        aria-label="다음 제품"
        className="fixed right-2 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-cream/85 text-ink-soft shadow-sm backdrop-blur-sm transition-transform active:scale-90 md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </div>
  );
}
