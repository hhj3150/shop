"use client";

// 보유 인증 목록 — lib/certifications.ts 한 곳에서만 읽는다.
//   유효기간이 지난 인증은 저절로 빠진다. 정적으로 만들어 둔 화면은 배포 뒤 며칠이고
//   그대로 떠 있으므로, 서버가 그린 목록(initialIds)으로 시작한 뒤 손님 기기의 오늘
//   날짜로 한 번 더 거른다 — 만료된 인증이 다음 배포까지 걸려 있지 않게.
import { useEffect, useState } from "react";
import { CERTIFICATIONS, activeCertifications, certValidityLabel } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";

export function CertList({
  initialIds,
  compact = false,
}: {
  initialIds: string[];
  compact?: boolean;
}) {
  const [ids, setIds] = useState(initialIds);
  useEffect(() => {
    setIds(activeCertifications(kstYmd(new Date().toISOString())).map((c) => c.id));
  }, []);
  const certs = CERTIFICATIONS.filter((c) => ids.includes(c.id));
  if (certs.length === 0) return null;

  // 제품 상세용 — 이름만 한 줄씩, 번호·기간은 작은 글씨로.
  if (compact) {
    return (
      <ul className="divide-y divide-line border-y border-line">
        {certs.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-4 py-3">
            <span className="t-footnote font-medium text-ink">{c.name}</span>
            <span className="t-caption shrink-0 text-right text-mute tabular-nums">{c.issuer}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {certs.map((c) => (
        <li key={c.id} className="rounded-2xl border border-gold/35 bg-cream/70 px-5 py-4">
          <p className="t-callout font-medium text-ink">{c.name}</p>
          <p className="t-caption mt-1 text-ink-soft">
            {c.issuer} · {c.scope}
          </p>
          <p className="t-caption mt-2 text-mute tabular-nums">
            {c.number} · {certValidityLabel(c)}
          </p>
        </li>
      ))}
    </ul>
  );
}
