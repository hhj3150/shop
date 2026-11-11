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
      <div className="mx-auto max-w-7xl px-5 pt-4 pb-16 sm:px-8 sm:pt-8 sm:pb-24">
      {/* 머리말 — 데스크톱은 제목과 분류 칩을 한 줄에 둔다. 따로 쌓으면(제목·문단·칩) 상품 카드가
          화면 한 장 아래로 밀린다(1440×900 에서 첫 상품 사진 아래 끝이 1,287px 이었다).
          모바일에서는 제목을 화면에서 숨긴다(스크린리더에는 남긴다) — 실제 휴대폰은 주소창
          때문에 화면이 더 짧다. 장식 제목 한 줄보다 첫 상품 사진이 먼저 보여야 한다. */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="max-sm:sr-only font-serif-kr text-[clamp(1.2rem,2.4vw,1.75rem)] font-medium leading-[1.25] tracking-[-0.015em] text-ink">
          단 {COUNT_KR[live.length] ?? live.length} 가지.{" "}
          <span className="text-mute">곁에 둘 가치가 있는 것만.</span>
        </h2>
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

      {/* 데스크톱은 네 가지를 한 줄에 — 두 줄로 나누면 둘은 화면 밖이다. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-6 sm:gap-5 lg:grid-cols-4">
        {shown.map((p, i) => (
          <Reveal key={p.id} delay={(i % 2) * 80}>
            <article className="group flex h-full flex-col items-center rounded-[22px] bg-cream/60 px-3 pt-4 pb-5 text-center transition-all duration-500 hover:-translate-y-1.5 hover:bg-cream hover:shadow-[0_44px_90px_-34px_rgba(40,30,15,0.32)] sm:rounded-[28px] sm:px-6 sm:pt-8 sm:pb-7">
              <p
                className="t-caption font-semibold uppercase tracking-[0.18em]"
                style={{ color: p.accent }}
              >
                {p.badge}
              </p>
              {/* 한 줄에 네 장이 놓이는 폭에서는 이름 자리를 두 줄로 잡아 둔다 — 요거트만 두 줄이라
                  그대로 두면 사진 높이가 카드마다 어긋난다. */}
              <h3 className="mt-2 font-serif-kr text-[clamp(1.02rem,1.8vw,1.45rem)] font-medium leading-snug tracking-[-0.01em] text-ink lg:flex lg:min-h-[2.75em] lg:items-center">
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
                className="mt-4 flex w-full flex-1 flex-col items-center sm:mt-5"
              >
                <div className="relative h-44 w-full overflow-hidden rounded-[16px] bg-studio sm:h-72 sm:rounded-[20px] lg:h-56">
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
                    sizes="(max-width:640px) 44vw, (max-width:1024px) 44vw, 22vw"
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
