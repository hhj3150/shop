import type { ProductHighlights as Highlights } from "@/lib/products";

// 인라인 강조 규약: *키워드* → 굵게, ~숫자~ → 명조 강조.
// strongClass로 *..*의 색을 제어(선언=골드, 본문=잉크).
function renderRich(text: string, strongClass: string) {
  return text
    .split(/(\*[^*]+\*|~[^~]+~)/g)
    .filter(Boolean)
    .map((part, i) => {
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <strong key={i} className={strongClass}>
            {part.slice(1, -1)}
          </strong>
        );
      }
      if (part.startsWith("~") && part.endsWith("~")) {
        return (
          <span
            key={i}
            className="font-serif-kr text-[1.12em] font-semibold text-ink lining-nums tabular-nums"
          >
            {part.slice(1, -1)}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
}

// 0.01% 선언 — 제목 바로 아래(태그라인 자리). 브랜드의 한 줄.
export function ProductKicker({ highlights }: { highlights?: Highlights }) {
  if (!highlights) return null;

  return (
    <p className="mx-auto mt-3 max-w-md font-serif-kr text-[clamp(1rem,2.1vw,1.18rem)] font-medium leading-snug tracking-[-0.015em] text-ink lg:mx-0">
      {highlights.kicker.split("\n").map((line, i) => (
        <span key={i} className="block">
          {renderRich(line, "font-medium text-gold")}
        </span>
      ))}
    </p>
  );
}

// 히어로 요약 — CTA 버튼 아래. 핵심 차별점만 무선(無線) 스펙시트로.
// 효능 표현 없이 사실만(식품 표시·광고법 안전선).
export function ProductHighlights({ highlights }: { highlights?: Highlights }) {
  if (!highlights) return null;
  const { rows, proof } = highlights;

  return (
    <div className="mx-auto mt-6 max-w-sm border-t border-ink/10 pt-6 text-left lg:mx-0 lg:max-w-none">
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.k} className="flex items-baseline gap-4">
            <dt className="w-12 flex-none pt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/35">
              {row.k}
            </dt>
            <dd className="text-[13.5px] leading-snug text-ink-soft">
              {renderRich(row.v, "font-semibold text-ink")}
              {row.em && (
                <span className="text-[11.5px] text-ink/45"> · {row.em}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[10.5px] tracking-wide text-ink/35">{proof}</p>
    </div>
  );
}
