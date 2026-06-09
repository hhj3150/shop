"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { lockDirection, shouldSwipe, type LockDir } from "@/lib/swipe-gesture";

// 모바일에서 좌우로 밀면 이전/다음 제품으로 이동. 양옆 화살표로도 바로 이동 가능.
//   세로 스크롤 오발동 방지: 제스처 첫 움직임의 방향을 잠가(direction lock), 세로로
//   시작한 스크롤은 끝에서 가로로 휘어도 페이지를 넘기지 않는다.
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
  const locked = useRef<LockDir>("none");

  // 화면 양 가장자리에서 시작한 터치는 OS의 뒤로/앞으로 제스처와 겹치므로 무시한다.
  const EDGE_GUARD = 24;

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    locked.current = "none";
    if (t.clientX <= EDGE_GUARD || t.clientX >= window.innerWidth - EDGE_GUARD) {
      start.current = null;
      return;
    }
    start.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchMove(e: TouchEvent) {
    if (!start.current || locked.current !== "none") return;
    const t = e.touches[0];
    // 첫 유의미한 움직임에서 가로/세로를 확정한다. 세로면 이후 가로 드리프트를 무시.
    locked.current = lockDirection(t.clientX - start.current.x, t.clientY - start.current.y);
  }

  function onTouchEnd(e: TouchEvent) {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x;
    const wasLocked = locked.current;
    start.current = null;
    locked.current = "none";
    // 가로로 잠긴(=의도된 좌우 스와이프) 충분한 이동일 때만 페이지를 넘긴다.
    if (!shouldSwipe(wasLocked, dx)) return;
    router.push(dx < 0 ? nextHref : prevHref);
  }

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
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
