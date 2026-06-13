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
