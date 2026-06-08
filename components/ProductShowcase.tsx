"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS, formatKRW, subscribePrice, type ProductLine } from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";
import { Reveal } from "./Reveal";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";
import { LogoBubbles } from "./LogoBubbles";

type Filter = "all" | ProductLine;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "milk", label: "밀크" },
  { key: "yogurt", label: "요거트" },
];

const PRODUCTS_CONFETTI: ConfettiItem[] = [
  { shape: "heart", color: HEY.rose, size: 26, top: "8%", left: "5%", rotate: -14, opacity: 0.5 },
  { shape: "squiggle", color: HEY.green, size: 40, top: "18%", right: "7%", rotate: 12, opacity: 0.45 },
  { shape: "dot", color: HEY.orange, size: 16, top: "42%", left: "3%", opacity: 0.55 },
  { shape: "comma", color: HEY.blue, size: 30, bottom: "22%", right: "4%", rotate: -8, opacity: 0.45 },
  { shape: "blob", color: HEY.deepOrange, size: 34, bottom: "8%", left: "8%", rotate: 18, opacity: 0.4 },
  { shape: "arc", color: HEY.blue, size: 38, top: "55%", right: "10%", rotate: 24, opacity: 0.4 },
  { shape: "tilde", color: HEY.rose, size: 34, bottom: "38%", left: "2%", rotate: -10, opacity: 0.45 },
];

export function ProductShowcase() {
  const [filter, setFilter] = useState<Filter>("all");
  const { map } = useStorefrontCatalog();
  const live = visibleProducts(PRODUCTS, map);
  const shown = filter === "all" ? live : live.filter((p) => p.line === filter);

  return (
    <section id="products" className="relative scroll-mt-20 overflow-hidden">
      <Scatter items={PRODUCTS_CONFETTI} />
      <LogoBubbles />
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
      {/* Store greeting */}
      <Reveal>
        <p className="eyebrow">Collection</p>
        <h2 className="mt-3 text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-[1.08] tracking-[-0.01em] text-ink">
          단 네 가지.
          <br />
          <span className="text-mute">곁에 둘 가치가 있는 것만.</span>
        </h2>
        <p className="mt-5 text-[clamp(1rem,2.4vw,1.3rem)] font-medium leading-relaxed text-ink-soft">
          아침에 짜서, 다음 날 도착.{" "}
          <span className="text-gold-deep">우유는 신선함이 생명입니다.</span>
        </p>
      </Reveal>

      {/* Category chips */}
      <div className="mt-10 flex justify-center">
        <div className="inline-flex gap-1.5 rounded-full border border-line bg-cream/70 p-1.5 backdrop-blur-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-full px-5 py-2 text-[14px] font-medium tracking-wide transition-colors ${
                filter === f.key ? "bg-ink text-cream" : "text-ink-soft hover:text-hey-blue"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {shown.map((p, i) => (
          <Reveal key={p.id} delay={(i % 2) * 80}>
            <article className="group flex h-full flex-col items-center rounded-[28px] bg-cream/60 px-6 pt-10 pb-8 text-center transition-all duration-500 hover:-translate-y-1.5 hover:bg-cream hover:shadow-[0_44px_90px_-34px_rgba(40,30,15,0.32)] sm:rounded-[32px] sm:px-8 sm:pt-12 sm:pb-9">
              <p
                className="text-[13px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: p.accent }}
              >
                {p.badge}
              </p>
              <h3 className="mt-2 text-[clamp(1.3rem,2.4vw,1.6rem)] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {p.name}
              </h3>
              <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[14px] text-mute">
                <span>{p.volume}</span>
              </div>
              {p.soldOut && (
                <span className="mt-2 inline-block rounded-full bg-ink/8 px-3 py-1 text-[12px] font-semibold tracking-wide text-mute">
                  품절
                </span>
              )}

              <Link
                href={`/products/${p.id}`}
                className="mt-8 flex w-full flex-1 flex-col items-center"
              >
                <div className="relative h-72 w-full overflow-hidden rounded-[20px] bg-paper sm:h-80">
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    width={720}
                    height={720}
                    sizes="(max-width:640px) 88vw, 40vw"
                    className="h-full w-full object-contain p-3 transition-transform duration-700 group-hover:scale-[1.04] sm:p-4"
                  />
                </div>
              </Link>

              <p className="mt-7 text-[clamp(1.35rem,3vw,1.6rem)] font-semibold leading-none text-ink tabular-nums lining-nums">
                {formatKRW(subscribePrice(p.price))}
                <span className="ml-1.5 align-baseline text-[13px] font-normal text-mute">회원가</span>
              </p>
              <p className="mt-1.5 text-[12.5px] text-mute tabular-nums lining-nums">
                정가 {formatKRW(p.price)} · {p.taxFree ? "면세품" : "부가세 포함"}
              </p>

              <div className="mt-7 flex w-full max-w-xs flex-col items-center gap-3">
                {p.soldOut ? (
                  <span
                    aria-disabled="true"
                    className="w-full cursor-not-allowed rounded-full bg-ink/30 px-6 py-3 text-center text-[15px] font-medium text-cream/80"
                  >
                    품절
                  </span>
                ) : (
                  <Link
                    href={`/products/${p.id}`}
                    className="w-full rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-cream transition-transform hover:scale-[1.03] active:scale-[0.98]"
                  >
                    구독 신청
                  </Link>
                )}
                <Link
                  href={`/products/${p.id}`}
                  className="text-[14px] tracking-wide text-gold-deep underline-offset-4 hover:underline"
                >
                  더 알아보기 →
                </Link>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  );
}
