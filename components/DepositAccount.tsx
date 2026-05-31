"use client";

import { useState } from "react";
import { DEPOSIT } from "@/lib/site";

// 무통장입금 계좌 표시 + 한 번 탭으로 계좌번호 복사.
// 대부분의 결제가 스마트폰에서 일어나므로, 긴 계좌번호를 손으로 선택하지 않고
// 곧장 은행 앱에 붙여넣을 수 있도록 복사 버튼을 제공한다.
export function DepositAccount() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(DEPOSIT.account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 권한 거부 등 → 사용자가 직접 선택할 수 있으므로 조용히 무시
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-3">
        <p className="font-serif-kr text-lg text-ink">
          {DEPOSIT.bank} <span className="tabular-nums">{DEPOSIT.account}</span>
        </p>
        <button
          type="button"
          onClick={copy}
          aria-label="계좌번호 복사"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-gold/50 px-4 text-[13px] font-medium text-gold-deep transition-colors hover:bg-gold/10 active:bg-gold/20"
        >
          {copied ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h8" strokeLinecap="round" />
            </svg>
          )}
          {copied ? "복사됨" : "계좌 복사"}
        </button>
      </div>
      <p className="mt-0.5 text-[14px] text-mute">예금주 {DEPOSIT.holder}</p>
    </div>
  );
}
