"use client";

import { useEffect, useState } from "react";
import {
  fetchAllReviews,
  reviewSummary,
  maskName,
  type ReviewSummary,
} from "@/lib/reviews";
import { Stars } from "./Stars";

// 밝은 카드(가입 폼)와 어두운 밴드(홈 구독 섹션) 두 맥락에서 같은 데이터를 쓰되
// 배경에 맞는 색만 바꾼다. 새 색을 만들지 않고 기존 토큰만 조합한다.
type Variant = "light" | "dark";
const THEME: Record<Variant, {
  card: string; average: string; sub: string; divider: string; author: string; body: string;
}> = {
  light: {
    card: "border-line bg-paper",
    average: "text-ink",
    sub: "text-mute",
    divider: "border-line",
    author: "text-gold-deep",
    body: "text-ink-soft",
  },
  dark: {
    card: "border-cream/20 bg-cream/[0.04]",
    average: "text-cream",
    sub: "text-cream/60",
    divider: "border-cream/15",
    author: "text-gold",
    body: "text-cream/75",
  },
};

// 결정 지점의 소셜 프루프. 전체 후기 평균·개수와 최근 후기를 보여준다.
// 후기가 0개이거나 데이터 미설정이면 아무것도 렌더하지 않는다(약한 증거는 역효과).
export function SocialProof({ variant = "light" }: { variant?: Variant } = {}) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const t = THEME[variant];

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
      className={`mt-4 rounded-2xl border p-5 sm:p-6 ${t.card}`}
    >
      <div className="flex items-center gap-4">
        <p className={`font-serif-kr text-3xl tabular-nums ${t.average}`}>
          {summary.average.toFixed(1)}
        </p>
        <div>
          <Stars value={summary.average} size={18} />
          <p className={`mt-1 text-[13px] ${t.sub}`}>
            먼저 받아보신 회원 후기 {summary.count}개
          </p>
        </div>
      </div>

      {summary.recent.length > 0 && (
        <ul className={`mt-4 space-y-2.5 border-t pt-4 ${t.divider}`}>
          {summary.recent.map((r) => (
            <li
              key={r.id}
              className="flex gap-2 text-[13px] leading-relaxed"
            >
              <span className={`shrink-0 ${t.author}`}>
                {maskName(r.author_name)}
              </span>
              <span className={`min-w-0 flex-1 truncate ${t.body}`}>
                {r.body}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
