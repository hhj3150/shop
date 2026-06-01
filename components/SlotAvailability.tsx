"use client";

import { useEffect, useState } from "react";
import {
  getDayCounts,
  remaining,
  isWaitlisted,
  totalRemainingSeats,
  type DayCounts,
} from "@/lib/subscriptions";
import { DELIVERY_DAYS, DELIVERY_DAY_LABEL } from "@/lib/cart";

// 홈 구독 섹션(어두운 배경)에 올리는 실시간 잔여 자리 표시.
// 요일별 선착순 100석 · 다섯 요일 통틀어 500석 가운데 지금 남은 수를 보여준다.
// 수치는 subscription_day_count 뷰(집계만 노출, 개인정보 없음)에서 가져온다.
export function SlotAvailability() {
  const [counts, setCounts] = useState<DayCounts | null>(null);

  useEffect(() => {
    let alive = true;
    getDayCounts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        // 환경변수 미설정 등 → 정적 안내(— 표시)로 폴백
      });
    return () => {
      alive = false;
    };
  }, []);

  const totalRemaining = counts ? totalRemainingSeats(counts) : null;

  return (
    <div className="mt-10 rounded-2xl border border-cream/15 bg-cream/[0.04] p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-cream/60">지금 남은 자리</p>
        <p className="font-display text-[11px] uppercase tracking-[0.3em] text-cream/45">
          Live
        </p>
      </div>
      <p className="mt-1 flex items-baseline">
        <span className="gold-foil font-display text-[2.6rem] leading-none tabular-nums">
          {totalRemaining === null ? "—" : totalRemaining}
        </span>
        <span className="ml-2 text-[14px] text-cream/55">/ 500석</span>
      </p>

      <div className="mt-5 grid grid-cols-5 gap-1.5">
        {DELIVERY_DAYS.map((d) => {
          const c = counts?.[d] ?? null;
          const rem = c ? remaining(c) : null;
          const full = c ? isWaitlisted(c) : false;
          return (
            <div
              key={d}
              className="flex flex-col items-center rounded-xl border border-cream/15 bg-cream/[0.03] py-2.5"
            >
              <span className="text-[14px] text-cream">
                {DELIVERY_DAY_LABEL[d].charAt(0)}
              </span>
              <span
                className={`mt-0.5 text-[10px] tabular-nums ${
                  full ? "text-cream/40" : "text-gold"
                }`}
              >
                {rem === null ? "·" : full ? "마감" : `${rem}석`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
