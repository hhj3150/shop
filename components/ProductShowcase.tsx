"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  PRODUCTS,
  SUB_PERIODS,
  discountForPeriod,
  discountRangeLabel,
  formatKRW,
  subscribePrice,
  type ProductLine,
} from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";
import { Reveal } from "./Reveal";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";
import { ProductSticker } from "./ProductSticker";

type Filter = "all" | ProductLine;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "milk", label: "밀크" },
  { key: "yogurt", label: "요거트" },
  { key: "aftermilk", label: "애프터밀크" },
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

// 노출 제품 수 → 한글 수사. 판매중지(숨김)로 개수가 바뀌어도 제목이 어긋나지 않게.
const COUNT_KR = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];

// 정기구독 최저가(가장 긴 기간)의 할인율 — 카드의 '정기구독 ○○원~' 표기에 쓴다.
const maxRate = discountForPeriod(SUB_PERIODS[SUB_PERIODS.length - 1]);

export function ProductShowcase() {
  const [filter, setFilter] = useState<Filter>("all");
  const { map } = useStorefrontCatalog();
  const live = visibleProducts(PRODUCTS, map);
  const shown = filter === "all" ? live : live.filter((p) => p.line === filter);
  // 숨김 제품만 있는 라인은 필터 칩도 숨긴다(눌러도 빈 목록만 나오는 칩 방지).
  const filters = FILTERS.filter(
    (f) => f.key === "all" || live.some((p) => p.line === f.key)
  );

  return (
    <section id="products" className="relative scroll-mt-20 overflow-hidden">
      <Scatter items={PRODUCTS_CONFETTI} />
      <div className="mx-auto max-w-7xl px-5 pt-8 pb-16 sm:px-8 sm:pt-10 sm:pb-24">
      {/* Store greeting — 우아한 serif·절제된 크기로(상품 히어로와 통일, 덜 투박) */}
      <Reveal>
        {/* 모바일에서는 제목을 한 줄로 줄인다 — 첫 화면에 상품 카드가 걸려야 한다. */}
        <p className="eyebrow hidden text-gold-deep sm:block">Collection</p>
        <h2 className="text-center font-serif-kr text-[clamp(1.2rem,3.2vw,2.2rem)] font-medium leading-[1.25] tracking-[-0.015em] text-ink sm:mt-3 sm:text-left">
          단 {COUNT_KR[live.length] ?? live.length} 가지.
          <br className="hidden sm:block" />{" "}
          <span className="text-mute">곁에 둘 가치가 있는 것만.</span>
        </h2>
        <p className="mt-4 hidden text-[15px] leading-relaxed text-ink-soft sm:block sm:text-[15.5px]">
          아침에 짜서, 다음 날 도착.{" "}
          <span className="text-gold-deep">우유는 신선함이 생명입니다.</span>
        </p>
      </Reveal>

      {/* Category chips */}
      <div className="mt-5 flex justify-center sm:mt-7">
        <div className="inline-flex gap-1.5 rounded-full border border-line bg-cream/70 p-1.5 backdrop-blur-sm">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`min-h-11 rounded-full px-5 py-2 text-[14px] font-medium tracking-wide transition-colors ${
                filter === f.key ? "bg-ink text-cream" : "text-ink-soft hover:text-hey-blue"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 모바일도 2열 — 한 화면에 한 병씩이면 네 가지를 견주려고 네 화면을 넘겨야 한다. */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:mt-8 sm:gap-6">
        {shown.map((p, i) => (
          <Reveal key={p.id} delay={(i % 2) * 80}>
            <article className="group flex h-full flex-col items-center rounded-[22px] bg-cream/60 px-3 pt-6 pb-5 text-center transition-all duration-500 hover:-translate-y-1.5 hover:bg-cream hover:shadow-[0_44px_90px_-34px_rgba(40,30,15,0.32)] sm:rounded-[32px] sm:px-8 sm:pt-12 sm:pb-9">
              <p
                className="t-caption font-semibold uppercase tracking-[0.18em]"
                style={{ color: p.accent }}
              >
                {p.badge}
              </p>
              <h3 className="mt-2 font-serif-kr text-[clamp(1.02rem,2.4vw,1.6rem)] font-medium leading-snug tracking-[-0.01em] text-ink">
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
                className="mt-4 flex w-full flex-1 flex-col items-center sm:mt-8"
              >
                <div className="relative h-44 w-full overflow-hidden rounded-[16px] bg-studio sm:h-80 sm:rounded-[20px]">
                  {p.sticker && (
                    <ProductSticker
                      title={p.sticker.title}
                      sub={p.sticker.sub}
                      className="left-3 top-3 max-sm:hidden sm:left-4 sm:top-4"
                    />
                  )}
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    width={720}
                    height={720}
                    sizes="(max-width:640px) 44vw, 40vw"
                    className="product-cut h-full w-full object-contain p-2 transition-transform duration-700 group-hover:scale-[1.04] sm:p-4"
                  />
                </div>
              </Link>

              {/* 1회 구매 전용(애프터밀크)은 구독 회원가가 없으니 정가만 노출한다. */}
              {p.onceOnly ? (
                <>
                  <p className="mt-4 text-[clamp(1.1rem,3vw,1.6rem)] font-semibold leading-none text-ink tabular-nums lining-nums sm:mt-7">
                    {formatKRW(p.price)}
                    <span className="ml-1.5 align-baseline text-[13px] font-normal text-mute">정가</span>
                  </p>
                  <p className="t-caption mt-1.5 leading-snug text-mute tabular-nums lining-nums">
                    1회 구매 전용 · {p.taxFree ? "면세품" : "부가세 포함"}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-4 text-[clamp(1.1rem,3vw,1.6rem)] font-semibold leading-none text-ink tabular-nums lining-nums sm:mt-7">
                    {/* 정가가 대표 가격이다 — 누구나 이 값에 한 번 살 수 있다. 예전에는 회원가(4주)를
                        크게 적어, 1회 구매 손님이 상세에 들어가서야 실제 값을 알았다. */}
                    {formatKRW(p.price)}
                  </p>
                  <p className="t-caption mt-2 font-medium leading-snug text-gold-deep tabular-nums lining-nums">
                    정기구독 {formatKRW(subscribePrice(p.price, maxRate))}~
                  </p>
                  <p className="t-caption mt-0.5 leading-snug text-mute tabular-nums lining-nums">
                    {discountRangeLabel()}% 할인 · {p.taxFree ? "면세품" : "부가세 포함"}
                  </p>
                </>
              )}

              <div className="mt-4 w-full max-w-xs sm:mt-7">
                {p.soldOut ? (
                  <span
                    aria-disabled="true"
                    className="block w-full cursor-not-allowed rounded-full bg-ink/30 px-6 py-3 text-center text-[15px] font-medium text-cream/80"
                  >
                    품절
                  </span>
                ) : (
                  <Link
                    href={`/products/${p.id}`}
                    className="flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-3 text-center t-footnote font-medium text-cream transition-transform hover:scale-[1.03] active:scale-[0.98] sm:px-6"
                  >
                    구매하기
                  </Link>
                )}
              </div>
            </article>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  );
}
