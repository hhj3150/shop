"use client";

import { useEffect, useState } from "react";
import {
  getDayCounts,
  totalRemainingSeats,
  type DayCounts,
} from "@/lib/subscriptions";
import { buildMembershipBenefits } from "@/lib/membership-benefits";
import { SUB_TOTAL_CAP } from "@/lib/products";

// 가입 폼 위에 두는 "안심 카드". 결정 지점에서 가치(회원 혜택)와
// 희소성(라이브 잔여석)을 다시 보여줘 폼 이탈을 줄인다.
// 잔여석 수치는 집계 뷰(개인정보 없음)에서만 읽고, 미설정 시 "—"로 폴백한다.
export function MembershipAssurance() {
  const [counts, setCounts] = useState<DayCounts | null>(null);

  useEffect(() => {
    let alive = true;
    getDayCounts()
      .then((c) => {
        if (alive) setCounts(c);
      })
      .catch(() => {
        // 환경변수 미설정 등 → 정적 폴백("—")
      });
    return () => {
      alive = false;
    };
  }, []);

  const remaining = counts ? totalRemainingSeats(counts) : null;
  const benefits = buildMembershipBenefits();

  return (
    <section
      aria-label="회원 혜택과 남은 자리"
      className="mt-7 rounded-2xl border border-line bg-cream p-5 sm:p-6"
    >
      <div className="flex items-baseline justify-between border-b border-line pb-4">
        <p className="text-[13px] text-mute">지금 남은 자리</p>
        <p className="font-display text-[10px] uppercase tracking-[0.3em] text-gold-deep">
          Live
        </p>
      </div>
      <p className="mt-3 flex items-baseline">
        <span className="font-display text-[2.4rem] leading-none tabular-nums text-gold-deep">
          {remaining === null ? "—" : remaining}
        </span>
        <span className="ml-2 text-[14px] text-mute">/ {SUB_TOTAL_CAP}석</span>
      </p>

      <ul className="mt-5 space-y-3">
        {benefits.map((b) => (
          <li key={b.title} className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-gold-deep"
            />
            <span>
              <span className="block text-[14px] font-medium text-ink">
                {b.title}
              </span>
              <span className="block text-[12.5px] leading-relaxed text-mute">
                {b.desc}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
