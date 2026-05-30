import Image from "next/image";

export function FarmBand() {
  return (
    <section className="relative h-[64svh] min-h-[420px] w-full overflow-hidden sm:h-[72svh]">
      <Image
        src="/brand/jersey-cow.jpg"
        alt="경기도 안성 송영신목장에서 건초를 먹는 A2 저지 소들"
        fill
        sizes="100vw"
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/25 to-ink/10" />

      <div className="absolute inset-x-0 bottom-0">
        <div className="mx-auto max-w-7xl px-5 pb-12 sm:px-8 sm:pb-16">
          <p className="font-display text-[12px] uppercase tracking-[0.32em] text-cream/75 sm:text-[13px]">
            Anseong · Made by Soil
          </p>
          <h2 className="mt-4 max-w-xl font-serif-kr text-[clamp(1.7rem,4.6vw,3rem)] font-medium leading-[1.18] text-cream">
            풀과 건초로 기른
            <br />
            <span className="text-gold">100% A2 저지.</span>
          </h2>
          <p className="mt-4 text-[13px] tracking-wide text-cream/60">
            경기도 안성 송영신목장에서 매주 갓 짜냅니다.
          </p>
        </div>
      </div>
    </section>
  );
}
