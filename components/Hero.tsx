import Image from "next/image";
import Link from "next/link";
import { Scatter, HEY, type ConfettiItem } from "./Confetti";
import { LogoBubbles } from "./LogoBubbles";

const HERO_CONFETTI: ConfettiItem[] = [
  { shape: "blob", color: HEY.green, size: 84, top: "16%", left: "-2%", rotate: -12, opacity: 0.5, className: "hidden sm:block" },
  { shape: "heart", color: HEY.rose, size: 40, top: "10%", left: "44%", rotate: 8 },
  { shape: "squiggle", color: HEY.blue, size: 64, top: "6%", right: "10%", rotate: -6 },
  { shape: "comma", color: HEY.orange, size: 34, top: "30%", right: "4%", rotate: 18, className: "hidden sm:block" },
  { shape: "dot", color: HEY.deepOrange, size: 18, top: "52%", left: "6%" },
  { shape: "arc", color: HEY.rose, size: 54, bottom: "16%", left: "40%", rotate: 4, className: "hidden sm:block" },
  { shape: "tilde", color: HEY.green, size: 58, bottom: "8%", right: "14%", rotate: -8 },
  { shape: "dot", color: HEY.blue, size: 14, bottom: "26%", right: "6%" },
  { shape: "comma", color: HEY.deepOrange, size: 30, bottom: "12%", left: "10%", rotate: -22, className: "hidden sm:block" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Scatter items={HERO_CONFETTI} />
      <LogoBubbles />
      <div className="mx-auto grid max-w-7xl items-center gap-6 px-5 pt-28 pb-14 sm:px-8 sm:pt-32 lg:min-h-[88svh] lg:grid-cols-2 lg:gap-8 lg:pb-16">
        {/* Copy */}
        <div className="flex flex-col items-center lg:items-start lg:text-left">
          <Image
            src="/brand/heymilk-logo.png"
            alt="송영신목장 A2 저지 헤이밀크 로고"
            width={800}
            height={800}
            priority
            className="mb-6 w-[176px] max-w-full sm:w-[208px]"
          />
          <p className="font-serif-kr text-[22px] font-semibold tracking-[0.01em] text-ink sm:text-[27px]">
            송영신목장
          </p>
          <p className="gold-foil mt-2 font-display text-[16px] font-semibold uppercase tracking-[0.28em] sm:text-[19px]">
            A2 Jersey Hay Milk
          </p>
          <h1 className="mt-5 font-serif-kr text-[clamp(2.1rem,7vw,4rem)] font-medium leading-[1.16] tracking-[-0.01em] text-ink">
            한 모금에 담긴
            <br />
            <span className="gold-foil">15년의 약속.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-md text-[14px] leading-relaxed text-ink-soft sm:text-[15px] lg:mx-0">
            매주 한 병, 목장에서 갓 짜낸 그대로 문 앞까지. 회원제 정기구독이 기본이지만,
            가볍게 단품으로 한 번 맛보셔도 좋습니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <Link
              href="/signup"
              className="w-full rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform hover:scale-[1.03] active:scale-[0.98] sm:w-auto"
            >
              회원으로 모시기
            </Link>
            <Link
              href="/#products"
              className="w-full rounded-full border border-ink/15 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink transition-[transform,colors] hover:border-gold hover:text-gold-deep active:scale-[0.98] sm:w-auto"
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
