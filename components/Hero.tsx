import Image from "next/image";
import Link from "next/link";
import { MembershipCounter } from "./MembershipCounter";

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
            className="mb-8 w-[104px] max-w-full sm:w-[112px]"
          />

          {/* Eyebrow — 한정·회원제 후크 */}
          <p className="font-display text-[11px] uppercase tracking-[0.34em] text-gold-deep">
            Limited Subscription · Members Only
          </p>

          {/* 센터 슬로건 — 페이지 위계의 중심 */}
          <h1 className="mt-6 max-w-xl text-balance font-serif-kr text-[clamp(1.75rem,4vw,2.9rem)] font-medium leading-[1.32] tracking-[-0.015em] text-ink">
            소중한 분들에게 최상의 우유를.
            <br />
            그리고 지속가능한 지구를.
          </h1>

          {/* 서브 한 줄 */}
          <p className="mt-6 max-w-md text-[14.5px] leading-relaxed text-mute sm:text-[15px]">
            하루 500리터만 생산합니다. 더 만들 수 있지만, 그러지 않습니다.
          </p>

          {/* 라이브 카운터 */}
          <div className="mt-8">
            <MembershipCounter />
          </div>

          {/* CTA */}
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              정기구독 신청하기
            </Link>
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

          {/* 하단 라인 — Save Our Soil */}
          <p className="mt-10 text-[12.5px] tracking-wide text-mute">
            Save Our Soil. Save Us. — 흙을 지키는 일이 우리를 지키는 일입니다.
          </p>
        </div>

        {/* Product visual — 흰배경 정렬샷(1448×1086) */}
        <div className="flex justify-center">
          <Image
            src="/brand/hero-row-white.jpg"
            alt="송영신목장 A2 저지 헤이밀크 제품 라인업"
            width={1448}
            height={1086}
            priority
            sizes="(max-width:1024px) 86vw, 50vw"
            className="h-auto w-[86%] max-w-[520px] object-contain lg:w-full lg:max-w-[600px]"
          />
        </div>
      </div>
    </section>
  );
}
