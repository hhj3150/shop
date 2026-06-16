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

// 히어로 요약 — CTA 버튼 아래. 선언 한 줄 + 무선(無線) 스펙시트.
// 효능 표현 없이 사실만(식품 표시·광고법 안전선).
export function ProductHighlights({ highlights }: { highlights?: Highlights }) {
  if (!highlights) return null;
  const { kicker, rows, proof } = highlights;

  return (
    <div className="mx-auto mt-6 max-w-sm border-t border-ink/10 pt-6 text-left lg:mx-0 lg:max-w-none">
      <p className="text-center font-serif-kr text-[clamp(1.15rem,2.4vw,1.4rem)] font-medium leading-[1.3] tracking-[-0.015em] text-ink lg:text-left">
        {kicker.split("\n").map((line, i) => (
          <span key={i} className="block">
            {renderRich(line, "font-medium text-gold")}
          </span>
        ))}
      </p>

      <dl className="mt-4 space-y-2">
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
