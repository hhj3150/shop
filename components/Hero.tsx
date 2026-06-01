import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-28 pb-16 sm:px-8 sm:pt-32 lg:min-h-[90svh] lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-20">
        {/* Copy */}
        <div className="flex flex-col items-center lg:items-start lg:text-left">
          <Image
            src="/brand/heymilk-logo.png"
            alt="송영신목장 A2 저지 헤이밀크 로고"
            width={800}
            height={800}
            priority
            className="mb-9 w-[132px] max-w-full sm:w-[144px]"
          />

          {/* 브랜드 워드마크 — 페이지의 중심. 절제된 위계로 크게, 그러나 고요하게. */}
          <h1 className="flex flex-col items-center lg:items-start">
            <span className="font-serif-kr text-[clamp(1.6rem,3.1vw,2.3rem)] font-medium leading-none tracking-[-0.015em] text-ink">
              송영신목장
            </span>
            <span className="mt-3.5 font-display text-[clamp(1.05rem,2.3vw,1.5rem)] font-medium uppercase leading-none tracking-[0.3em] text-gold-deep">
              A2&nbsp;·&nbsp;Jersey&nbsp;·&nbsp;Hay&nbsp;Milk
            </span>
          </h1>

          {/* 헤어라인 — 럭셔리 브랜드의 정적인 구분선. */}
          <span className="mt-8 block h-px w-14 bg-gold/40" />

          {/* 슬로건 — 작고 우아하게. 외치지 않고 속삭인다. */}
          <p className="mt-8 max-w-md text-balance font-serif-kr text-[clamp(1.15rem,2.1vw,1.6rem)] font-normal leading-[1.5] tracking-[-0.01em] text-ink">
            영국 왕실의 저지, 황금빛 로얄 밀크.
            <br />
            <span className="gold-foil font-medium">명품은, 향으로 증명됩니다.</span>
          </p>

          <p className="mx-auto mt-6 max-w-md text-[14.5px] leading-relaxed text-mute sm:text-[15px] lg:mx-0">
            코끝엔 청정 건초가 남긴 테르펜 향, 혀끝엔 저지 젖소의 진한 크리미함. 여기에 A2
            단백질까지 — 송영신목장이 한 병에 담은 단 하나의 우유입니다.
          </p>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              회원으로 모시기
            </Link>
            <Link
              href="/#products"
              className="w-full rounded-full border border-ink/12 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink-soft transition-[transform,border-color,color] duration-300 ease-[var(--ease-soft)] hover:border-gold hover:text-gold-deep active:scale-[0.98] sm:w-auto"
            >
              제품 보기 →
            </Link>
          </div>
        </div>

        {/* Product lineup */}
        <div className="flex justify-center">
          <Image
            src="/brand/lineup-iso.webp"
            alt="A2 저지 헤이밀크 180·750mL과 플레인 요거트 180·500mL 라인업"
            width={1192}
            height={1182}
            priority
            sizes="(max-width:1024px) 78vw, 46vw"
            className="h-auto w-[78%] max-w-[440px] object-contain drop-shadow-[0_40px_70px_rgba(40,30,15,0.14)] lg:w-full lg:max-w-[540px]"
          />
        </div>
      </div>
    </section>
  );
}
