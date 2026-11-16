"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  PRODUCTS,
  SUB_PERIODS,
  discountForPeriod,
  formatKRW,
  subscribePrice,
  type ProductLine,
} from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";
import { Reveal } from "./Reveal";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";

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

// 색 바탕 카드 — 제품마다 라벨 색에서 뽑은 바탕과, 배경을 지운 병 사진(public/products/cut).
//   ※ 누끼 넷은 같은 캔버스(560×1100)에 키 순서가 보이는 비율(750mL 1 : 500mL 0.85 : 180mL 0.76)로 앉혀 둔다.
//     실제 비율(1 : 0.77 : 0.53)을 그대로 쓰면 180mL 가 너무 작아 라벨이 안 읽혀 조금 눌렀다.
//     카드마다 object-contain 으로 꽉 채우면 180mL 가 750mL 보다 커 보인다(2026-11-16 회장님 지적).
// 병 사진은 원본(assets/product-photos)을 Higgsfield remove_background 로 누끼 딴 뒤 병 둘레만 남겨 잘랐다.
// 여기에 없는 제품(애프터밀크 등)은 예전처럼 크림 바탕에 원래 사진을 쓴다.
// label 은 용량 글씨 색 — 지정하지 않으면 제품의 accent 를 쓴다(연한 금색 바탕에서는 accent 대비가 4.5:1 에 못 미친다).
const TILE: Record<string, { bg: string; cut: string; label?: string }> = {
  "milk-180": { bg: "#f6e7c8", cut: "/products/cut/milk-180.webp", label: "#6b532c" },
  "milk-750": { bg: "#efd2a0", cut: "/products/cut/milk-750.webp", label: "#5a4524" },
  "yogurt-180": { bg: "#d8ebd3", cut: "/products/cut/yogurt-180.webp" },
  "yogurt-500": { bg: "#bfdcc9", cut: "/products/cut/yogurt-500.webp" },
};

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
            {/* 진열 카드 — 위에 이름과 값, 아래에 제품 사진을 크게, 오른쪽 아래 화살표. 카드 전체가 링크다.
                글은 용량·이름·값만 남긴다. 분류 영문 표기, 메모지, 할인·과세 설명, 버튼 글자는
                상세 페이지에서 본다 — 네 장이 한 줄에 놓이면 글이 많아 복잡해 보였다. */}
            <article className="h-full">
              <Link
                href={`/products/${p.id}`}
                aria-label={`${p.name} ${p.volume} ${formatKRW(p.price)}${p.soldOut ? " 품절" : ""}`}
                style={TILE[p.id] ? { backgroundColor: TILE[p.id].bg } : undefined}
                className="group relative flex h-full flex-col overflow-hidden rounded-[22px] bg-studio text-left transition-shadow duration-500 hover:shadow-[0_44px_90px_-34px_rgba(40,30,15,0.32)] sm:rounded-[28px]"
              >
                <div className="relative z-10 px-4 pt-4 sm:px-7 sm:pt-7">
                  <p className="t-caption font-semibold tracking-wide" style={{ color: TILE[p.id]?.label ?? p.accent }}>
                    {p.soldOut ? "품절" : p.volume}
                  </p>
                  {/* 이름 자리는 두 줄로 잡아 둔다 — 요거트만 두 줄이라 그대로 두면 사진 높이가 카드마다 어긋난다. */}
                  <h3 className="mt-1 min-h-[2.6em] font-serif-kr text-[clamp(1.05rem,1.9vw,1.5rem)] font-medium leading-[1.3] tracking-[-0.01em] text-ink">
                    {p.name}
                  </h3>
                  {/* 정가가 대표 가격이다 — 누구나 이 값에 한 번 살 수 있다. 예전에는 회원가(4주)를
                      크게 적어, 1회 구매 손님이 상세에 들어가서야 실제 값을 알았다.
                      1회 구매 전용(애프터밀크)은 구독 회원가가 없으니 정가만 노출한다. */}
                  <p className="mt-1.5 text-[15px] text-ink tabular-nums lining-nums sm:text-[17px]">
                    {formatKRW(p.price)}
                  </p>
                  {/* 색 바탕 위에서는 금색 글씨가 묻힌다 — 구독가는 먹색으로 쓴다. */}
                  {/* 구독가는 늘 다음 줄에 둔다 — 한 줄에 붙이면 좁은 화면에서 값이 긴 카드만 줄이 바뀌어 높이가 어긋난다. */}
                  {!p.onceOnly && (
                    <p className={`t-caption mt-0.5 tabular-nums lining-nums ${TILE[p.id] ? "text-ink/80" : "text-gold-deep"}`}>
                      정기구독 {formatKRW(subscribePrice(p.price, maxRate))}~
                    </p>
                  )}
                </div>

                {/* 사진은 이 칸 안에서만 키운다 — 칸을 넘치면 불투명한 사진 바탕이 위의 이름과 값을 덮는다. */}
                <div className="relative aspect-[5/6] w-full flex-1 overflow-hidden">
                  {TILE[p.id] ? (
                    <Image
                      src={TILE[p.id].cut}
                      alt=""
                      width={560}
                      height={1100}
                      sizes="(max-width:1024px) 48vw, 24vw"
                      className={`absolute inset-x-0 bottom-5 top-2 mx-auto h-[calc(100%-1.75rem)] w-full object-contain object-bottom drop-shadow-[0_14px_16px_rgba(60,40,10,0.18)] transition-transform duration-700 group-hover:-translate-y-[2%] ${p.soldOut ? "opacity-60" : ""}`}
                    />
                  ) : (
                  <Image
                      src={p.image}
                      alt=""
                      width={720}
                      height={720}
                      sizes="(max-width:1024px) 48vw, 24vw"
                      className={`product-cut absolute inset-0 h-full w-full scale-[1.3] object-contain transition-transform duration-700 group-hover:scale-[1.36] ${p.soldOut ? "opacity-60" : ""}`}
                    />
                  )}
                </div>

                <span
                  aria-hidden="true"
                  className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-cream text-ink shadow-[0_2px_10px_rgba(40,30,15,0.18)] transition-transform group-hover:scale-110 sm:bottom-5 sm:right-5 sm:h-10 sm:w-10"
                >
                  <svg width="9" height="14" viewBox="0 0 9 14">
                    <path d="M1.5 1.5L7 7l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            </article>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  );
}
