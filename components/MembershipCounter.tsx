"use client";

import { useEffect, useState } from "react";
import {
  getDayCounts,
  totalRemainingSeats,
  type DayCounts,
} from "@/lib/subscriptions";
import { SUB_TOTAL_CAP } from "@/lib/products";

// 히어로(순백 배경)에 올리는 실시간 회원 현황.
// "500분 중 N분과 함께 · 남은 자리 X" — 데이터는 SlotAvailability와 동일하게
// subscription_day_count 집계 뷰(개인정보 없음)에서 가져온다.
// 데이터/순수 로직만 공유하고 표현은 분리(밝은 배경).
export function MembershipCounter() {
  const [counts, setCounts] = useState<DayCounts | null>(null);

  // eslint react-hooks/set-state-in-effect 회피: alive 가드 + .then(setState).
  useEffect(() => {
    let alive = true;
    getDayCounts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        // 환경변수 미설정 등 → — 표시로 폴백(SlotAvailability와 동일)
      });
    return () => {
      alive = false;
    };
  }, []);

  const remaining = counts ? totalRemainingSeats(counts) : null;
  const membersJoined = remaining === null ? null : SUB_TOTAL_CAP - remaining;

  // 매진: 로드된 상태에서 잔여 0일 때만(로드 전 null은 매진으로 보지 않음).
  if (remaining === 0) {
    return (
      <p className="text-[14px] leading-relaxed text-ink-soft">
        이번 시즌 마감 ·{" "}
        <span className="text-gold-deep">대기 등록</span>으로 모십니다
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px] leading-relaxed text-mute">
      <span className="font-display tabular-nums text-ink">{SUB_TOTAL_CAP}</span>
      <span>분 중</span>
      <span className="font-display tabular-nums text-ink">
        {membersJoined === null ? "—" : membersJoined}
      </span>
      <span>분과 함께 ·</span>
      <span className="text-ink-soft">남은 자리</span>
      <span className="gold-foil font-display text-[1.15rem] leading-none tabular-nums">
        {remaining === null ? "—" : remaining}
      </span>
    </p>
  );
}
