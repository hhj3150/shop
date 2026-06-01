"use client";

import { useState } from "react";
import { formatKRW } from "@/lib/products";
import { depositAmountDigits } from "@/lib/deposit-guidance";

// 입금 금액을 보여주고, 한 번 탭으로 '정확한 숫자'를 클립보드에 복사한다.
// 무통장입금의 가장 흔한 실수(금액 오기)를 줄여, 입금-확인 지연 없이 회원 자리가 확정되게 한다.
export function CopyAmount({ amount }: { amount: number }) {
  const [copied, setCopied] = useState(false);
  const digits = depositAmountDigits(amount);

  async function copy() {
    if (!digits) return;
    try {
      await navigator.clipboard.writeText(digits);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 권한 거부 등 → 사용자가 직접 입력할 수 있으므로 조용히 무시
    }
  }

  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="font-serif-kr text-[22px] tabular-nums text-gold-deep">
        {formatKRW(amount)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label="입금 금액 복사"
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-gold/50 px-3 text-[12px] font-medium text-gold-deep transition-colors hover:bg-gold/10 active:bg-gold/20"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h8" strokeLinecap="round" />
          </svg>
        )}
        {copied ? "복사됨" : "금액 복사"}
      </button>
    </span>
  );
}
