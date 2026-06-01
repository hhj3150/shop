"use client";

import { useEffect, useState } from "react";
import {
  fetchAllReviews,
  reviewSummary,
  maskName,
  type ReviewSummary,
} from "@/lib/reviews";
import { Stars } from "./Stars";

// 결정 지점(가입 폼)의 소셜 프루프. 전체 후기 평균·개수와 최근 후기를 보여준다.
// 후기가 0개이거나 데이터 미설정이면 아무것도 렌더하지 않는다(약한 증거는 역효과).
export function SocialProof() {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAllReviews()
      .then((rows) => {
        if (alive) setSummary(reviewSummary(rows));
      })
      .catch(() => {
        // 미설정/오류 → 표시하지 않음
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!summary || summary.count === 0) return null;

  return (
    <section
      aria-label="고객 후기 요약"
      className="mt-4 rounded-2xl border border-line bg-paper p-5 sm:p-6"
    >
      <div className="flex items-center gap-4">
        <p className="font-serif-kr text-3xl tabular-nums text-ink">
          {summary.average.toFixed(1)}
        </p>
        <div>
          <Stars value={summary.average} size={18} />
          <p className="mt-1 text-[13px] text-mute">
            먼저 받아보신 회원 후기 {summary.count}개
          </p>
        </div>
      </div>

      {summary.recent.length > 0 && (
        <ul className="mt-4 space-y-2.5 border-t border-line pt-4">
          {summary.recent.map((r) => (
            <li
              key={r.id}
              className="flex gap-2 text-[13px] leading-relaxed"
            >
              <span className="shrink-0 text-gold-deep">
                {maskName(r.author_name)}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-soft">
                {r.body}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
