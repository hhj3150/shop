"use client";

// 하절기 휴가 안내 배너 — 기간이 지나면 스스로 사라진다(코드 정리 불필요).
//   발송일 자체는 lib/holidays.ts FARM_CLOSURES 가 계산에 반영하므로,
//   이 배너는 '왜 발송일이 밀리는지'를 설명하는 역할만 한다.
//   SSR 스냅숏은 null(서버에선 렌더하지 않음) → 하이드레이션 불일치 없이
//   클라이언트에서 오늘 날짜(KST)로 판단해 나타난다.

import { useSyncExternalStore } from "react";
import { toISODate } from "@/lib/ship-date";

// 노출 종료일(휴무 마지막 날). 이후엔 렌더하지 않는다.
const NOTICE_UNTIL = "2026-08-17";

const subscribe = () => () => {};
function kstTodayISO(): string {
  // 배포 환경(UTC)에서도 한국 날짜로 판단한다.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return toISODate(new Date(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

export function VacationNotice({ className = "" }: { className?: string }) {
  const today = useSyncExternalStore(subscribe, kstTodayISO, () => null);
  if (!today || today > NOTICE_UNTIL) return null;

  return (
    <div
      role="status"
      className={`rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-[13px] leading-relaxed text-gold-deep ${className}`}
    >
      <strong className="font-medium">하절기 휴가 안내</strong> — 8월 9일(일)부터 8월
      17일(월)까지 목장 발송이 쉬어갑니다. 단품 주문은{" "}
      <strong className="font-medium">8월 18일(화) 발송 예정</strong>입니다. (8월 6일(목)
      자정까지 주문분은 8월 7일(금) 정상 발송)
      <br />
      정기구독은 휴무에 걸린 회차를 <strong className="font-medium">다음 주 같은 요일</strong>로
      이어 보내드립니다 — 월요일 구독은 8월 17일이 광복절 대체공휴일이라 8월 18일(화)에 화요일
      구독과 함께 발송되고, 수·목·금은 8월 19·20·21일입니다. 총 배송 회차는 그대로이며 종료일만
      한 주 밀립니다.
    </div>
  );
}
