import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-5 pt-28 pb-14 sm:px-8 sm:pt-32 lg:min-h-[88svh] lg:grid-cols-2 lg:gap-8 lg:pb-16">
        {/* Copy */}
        <div className="text-center lg:text-left">
          <p className="text-[11px] uppercase tracking-[0.3em] text-mute sm:text-[12px]">
            A2 / A2 Jersey · Hay-fed
          </p>
          <h1 className="mt-5 font-serif-kr text-[clamp(2.1rem,7vw,4rem)] font-medium leading-[1.14] tracking-[-0.02em] text-ink">
            선택받은 분의
            <br />
            <span className="text-gold-deep">식탁에만 닿습니다.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-[14px] leading-relaxed text-ink-soft sm:text-[15px] lg:mx-0">
            국내 1.6%의 희소한 A2 저지 원유, 유럽 전통 헤이밀크 방식 그대로.
            회원으로 모신 분께만, 선착순 500명 한정으로 엽니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform hover:scale-[1.03] sm:w-auto"
            >
              회원으로 모시기
            </Link>
            <Link
              href="/#products"
              className="w-full rounded-full border border-ink/15 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink transition-colors hover:border-gold hover:text-gold-deep sm:w-auto"
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
            sizes="(max-width:1024px) 80vw, 46vw"
            className="h-auto w-[80%] max-w-[440px] object-contain drop-shadow-[0_30px_55px_rgba(40,30,15,0.16)] lg:w-full lg:max-w-[520px]"
          />
        </div>
      </div>
    </section>
  );
}
