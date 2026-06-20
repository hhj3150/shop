import type { ProductSignature as Signature } from "@/lib/products";
import { Reveal } from "./Reveal";

// 시그니처 증명 — 제품별 단 하나의 대표 수치.
// 조판: 라틴 수치는 디스플레이 세리프(보석), 한글 단위는 작은 명조로 곁들임.
// 골드는 에이브로우 + 얇은 필레 한 줄에만(단일 포인트). 효능 표현 없이 사실·출처만.
export function ProductSignature({ signature }: { signature?: Signature }) {
  if (!signature) return null;
  const { topLabel, pre, figure, unit, caption, identity } = signature;

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 text-center sm:px-8 sm:py-24">
      <Reveal>
        <p className="text-[10px] tracking-[0.34em] text-gold-deep">{topLabel}</p>
        <p className="font-display mt-7 flex items-baseline justify-center gap-[0.1em] text-[clamp(2.5rem,4.8vw,3.25rem)] font-normal leading-none text-ink lining-nums">
          {pre && (
            <span className="font-serif-kr text-[0.4em] tracking-normal text-mute">
              {pre}
            </span>
          )}
          <span>{figure}</span>
          {unit && (
            <span className="font-serif-kr text-[0.4em] tracking-normal text-mute">
              {unit}
            </span>
          )}
        </p>
        <span className="mx-auto mt-7 block h-px w-7 bg-gold/45" aria-hidden />
        <p className="mt-6 text-[11px] tracking-wide text-mute">{caption}</p>
        <p className="mx-auto mt-4 max-w-sm break-keep text-[12.5px] leading-relaxed text-ink-soft/90">
          {identity}
        </p>
      </Reveal>
    </section>
  );
}
