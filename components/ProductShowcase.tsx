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
    <section id="products" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="text-center">
        <p className="eyebrow">Store</p>
        <h2 className="mt-4 text-[clamp(2.2rem,5vw,3.4rem)] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
          제품을 둘러보세요.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          우유 둘, 요거트 둘 — 같은 A2 저지 원유에서 시작합니다. 단품으로, 또는 정기구독 10% 할인으로.
        </p>
      </Reveal>

      {/* Clean lineup visual */}
      <Reveal delay={80} className="mt-10">
        <Image
          src="/brand/lineup-iso.webp"
          alt="송영신목장 A2 저지 라인업"
          width={1192}
          height={1182}
          sizes="(max-width:640px) 90vw, 640px"
          className="mx-auto h-auto w-full max-w-[640px]"
          priority
        />
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
              className={`rounded-full px-5 py-2 text-[13px] font-medium tracking-wide transition-colors ${
                filter === f.key
                  ? "bg-ink text-cream"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
                <p className="text-[14px] text-mute">{p.volume}</p>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-ink-soft">
                  {p.shortDesc}
                </p>
                <p className="mt-5 text-[15px] font-medium text-ink tabular-nums">
                  {formatKRW(p.price)}부터
                </p>
                <p className="text-[12px] text-gold-deep tabular-nums">
                  구독 시 {formatKRW(subscribePrice(p.price))}
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
