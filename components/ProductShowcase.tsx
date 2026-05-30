"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRODUCTS, formatKRW, subscribePrice, type ProductLine } from "@/lib/products";
import { Reveal } from "./Reveal";

type Filter = "all" | ProductLine;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "milk", label: "밀크" },
  { key: "yogurt", label: "요거트" },
];

export function ProductShowcase() {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? PRODUCTS : PRODUCTS.filter((p) => p.line === filter);

  return (
    <section id="products" className="mx-auto max-w-7xl px-5 pb-24 pt-16 sm:px-8 sm:pb-32 sm:pt-24">
      {/* Store greeting */}
      <Reveal>
        <p className="eyebrow">Store</p>
        <h2 className="mt-3 text-[clamp(2.4rem,6vw,4rem)] font-semibold leading-[1.04] tracking-[-0.025em] text-ink">
          스토어.
          <br />
          <span className="text-mute">가장 신선한 방법으로 만나는 법.</span>
        </h2>
      </Reveal>

      {/* Quick nav — Apple-style product shortcuts */}
      <Reveal delay={60}>
        <div className="-mx-5 mt-10 flex gap-8 overflow-x-auto px-5 pb-2 sm:mx-0 sm:justify-center sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PRODUCTS.map((p) => (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className="group flex shrink-0 flex-col items-center text-center"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-paper-2 transition-transform duration-500 group-hover:-translate-y-1">
                <Image
                  src={p.image}
                  alt={`${p.name} ${p.volume}`}
                  width={64}
                  height={80}
                  className="h-[78%] w-auto object-contain"
                />
              </div>
              <span className="mt-2 text-[12px] font-medium text-ink-soft group-hover:text-ink">
                {p.line === "milk" ? "헤이밀크" : "요거트"} {p.volume}
              </span>
            </Link>
          ))}
        </div>
      </Reveal>

      {/* Category chips */}
      <div className="mt-12 flex justify-center">
        <div className="inline-flex gap-1.5 rounded-full border border-line bg-cream/70 p-1.5 backdrop-blur-sm">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-full px-5 py-2 text-[13px] font-medium tracking-wide transition-colors ${
                filter === f.key ? "bg-ink text-cream" : "text-ink-soft hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((p, i) => (
          <Reveal key={p.id} delay={i * 70}>
            <article className="group flex h-full flex-col rounded-3xl bg-cream p-7 text-center transition-all duration-500 hover:-translate-y-1.5 hover:shadow-[0_30px_60px_-24px_rgba(40,30,15,0.28)]">
              <Link href={`/products/${p.id}`} className="flex flex-1 flex-col">
                <div className="relative mx-auto flex h-56 w-full items-center justify-center">
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    width={200}
                    height={250}
                    className="h-full w-auto object-contain drop-shadow-[0_18px_30px_rgba(40,30,15,0.16)] transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                </div>
                <p
                  className="mt-6 text-[12px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: p.accent }}
                >
                  {p.badge}
                </p>
                <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                  {p.name}
                </h3>
                <div className="mt-1 flex items-center justify-center gap-1.5 text-[14px] text-mute">
                  <span>{p.volume}</span>
                  <span aria-hidden>·</span>
                  <span className={p.taxFree ? "text-gold-deep" : "text-mute"}>
                    {p.taxFree ? "면세" : "과세"}
                  </span>
                </div>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-ink-soft">
                  {p.shortDesc}
                </p>
                <p className="mt-5 text-[15px] font-medium text-ink tabular-nums">
                  {formatKRW(p.price)}부터
                </p>
                <p className="text-[12px] text-gold-deep tabular-nums">
                  구독 시 {formatKRW(subscribePrice(p.price))}
                </p>
                <p className="mt-0.5 text-[11px] text-mute">
                  {p.taxFree ? "면세품" : "부가세 포함가"}
                </p>
              </Link>
              <div className="mt-6 flex flex-col items-center gap-3">
                <Link
                  href={`/products/${p.id}`}
                  className="w-full rounded-full bg-ink px-6 py-2.5 text-[14px] font-medium text-cream transition-transform hover:scale-[1.03]"
                >
                  구입하기
                </Link>
                <Link
                  href={`/products/${p.id}`}
                  className="text-[13px] tracking-wide text-gold-deep underline-offset-4 hover:underline"
                >
                  더 알아보기 →
                </Link>
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
