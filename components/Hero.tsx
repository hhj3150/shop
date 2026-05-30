import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-end justify-center overflow-hidden">
      <Image
        src="/brand/hero.jpg"
        alt="송영신목장 A2 저지 헤이밀크와 플레인 요거트"
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      {/* dissolve the poster's baked-in bottom caption into the paper background */}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-paper via-paper/85 to-transparent" />

      <div className="relative z-10 mx-auto max-w-3xl px-6 pb-12 text-center">
        <h1 className="sr-only">
          송영신목장 A2 저지 헤이밀크 — 목장이 직접 짓고, 직접 발효하고, 직접 보냅니다.
        </h1>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/#products"
            className="rounded-full bg-ink px-9 py-3.5 text-sm font-medium tracking-wide text-cream shadow-lg transition-transform hover:scale-[1.03]"
          >
            제품 둘러보기
          </Link>
          <Link
            href="/#subscribe"
            className="rounded-full border border-ink/25 bg-cream/80 px-9 py-3.5 text-sm font-medium tracking-wide text-ink backdrop-blur-sm transition-colors hover:border-gold hover:text-gold-deep"
          >
            정기구독 알아보기
          </Link>
        </div>
      </div>
    </section>
  );
}
