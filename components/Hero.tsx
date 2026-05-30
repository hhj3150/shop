import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 pt-28 pb-16 text-center">
      {/* oversized faint backdrop word */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-[16%] left-1/2 -translate-x-1/2 select-none font-display text-[34vw] font-light leading-none text-paper-2"
      >
        Jersey
      </span>

      <div className="relative z-10 flex flex-col items-center">
        <p className="eyebrow">Anseong · Hay-fed · Since 2007</p>

        <h1 className="mt-7 font-serif-kr text-[clamp(2.6rem,8vw,5.5rem)] font-medium leading-[1.05] tracking-[-0.02em] text-ink">
          한 잔의
          <br />
          <span className="font-display italic text-gold">정직함.</span>
        </h1>

        <p className="mt-6 max-w-md text-[15px] leading-loose text-ink-soft">
          국내 1.6%의 희소한 A2/A2 저지 원유. 사일리지 없이 건초만 먹은 헤이밀크를,
          목장이 직접 짓고 발효해 그대로 보냅니다.
        </p>

        {/* floating hero product */}
        <div className="relative mt-2 mb-2 flex h-[42vh] min-h-[260px] items-center justify-center">
          <Image
            src="/products/milk-750.png"
            alt="A2 저지 헤이밀크 750mL"
            width={300}
            height={360}
            priority
            className="animate-float h-full w-auto object-contain drop-shadow-[0_36px_60px_rgba(40,30,15,0.24)]"
          />
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/#products"
            className="rounded-full bg-ink px-9 py-3.5 text-sm font-medium tracking-wide text-cream transition-transform hover:scale-[1.03]"
          >
            제품 둘러보기
          </Link>
          <Link
            href="/#subscribe"
            className="text-sm font-medium tracking-wide text-gold-deep underline-offset-4 transition-colors hover:underline"
          >
            정기구독 알아보기 →
          </Link>
        </div>
      </div>

      {/* scroll cue */}
      <div className="absolute bottom-7 left-1/2 h-9 w-px -translate-x-1/2 bg-line">
        <span className="animate-scrollcue absolute left-1/2 top-0 block h-3 w-px -translate-x-1/2 bg-gold" />
      </div>
    </section>
  );
}
