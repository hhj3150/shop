import Image from "next/image";
import { MembershipCounter } from "./MembershipCounter";
import { SubscribeFilmCTA } from "./SubscribeFilmCTA";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-28 pb-16 sm:px-8 sm:pt-32 lg:min-h-[94svh] lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-20">
        {/* Copy */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <Image
            src="/brand/heymilk-logo.png"
            alt="송영신목장 A2 저지 헤이밀크 로고"
            width={800}
            height={800}
            priority
            sizes="112px"
            className="mb-4 w-[104px] max-w-full sm:w-[112px]"
          />

          {/* 워드마크 — 로고 아래 브랜드명(국문 + 골드포일 영문). 가볍게·우아하게. */}
          <p className="mb-7 font-display text-[clamp(1.2rem,5vw,1.7rem)] font-medium leading-snug tracking-[0.01em] text-ink">
            송영신목장{" "}
            <span className="gold-foil">A2 Jersey Hay Milk</span>
          </p>

          {/* 센터 슬로건 — 페이지 위계의 중심. 가볍고 우아한 serif(애플식, 덜 투박). */}
          <h1 className="max-w-2xl text-balance font-serif-kr text-[clamp(1.8rem,4.5vw,3.05rem)] font-medium leading-[1.32] tracking-[-0.015em] text-ink">
            소중한 분들에게 최상의 우유를.
            <br />
            그리고 지속가능한 지구를.
          </h1>

          {/* 서브 한 줄 */}
          <p className="mt-6 max-w-md text-[14.5px] leading-relaxed text-mute sm:text-[15px]">
            하루 500리터만 생산합니다.
            <br />더 만들 수 있지만, 그러지 않습니다.
          </p>

          {/* 라이브 카운터 */}
          <div className="mt-8">
            <MembershipCounter />
          </div>

          {/* CTA */}
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center lg:justify-start">
            <SubscribeFilmCTA className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98] sm:w-auto" />
            <a
              href="https://www.a2jerseymilk.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="우리의 철학 보기 (새 창에서 열림)"
              className="w-full rounded-full border border-ink/12 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink-soft transition-[transform,border-color,color] duration-300 ease-[var(--ease-soft)] hover:border-gold hover:text-gold-deep active:scale-[0.98] sm:w-auto"
            >
              우리의 철학 보기 →
            </a>
          </div>
        </div>

        {/* Product visual — 흰배경 정렬샷(1600×1195) */}
        <div className="flex justify-center">
          <Image
            src="/brand/hero-row-white.jpg"
            alt="송영신목장 A2 저지 헤이밀크 제품 라인업"
            width={1600}
            height={1195}
            priority
            sizes="(max-width:1024px) 86vw, 50vw"
            className="h-auto w-[86%] max-w-[520px] object-contain lg:w-full lg:max-w-[600px]"
          />
        </div>
      </div>
    </section>
  );
}
