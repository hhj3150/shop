import Image from "next/image";
import { Reveal } from "./Reveal";
import { BRAND_HOME } from "@/lib/site";

const FACTS = [
  { k: "1.6%", v: "국내 A2/A2 저지소 비율" },
  { k: "Hay-fed", v: "사일리지 없는 건초 급여" },
  { k: "0 첨가물", v: "우유와 유산균, 그뿐" },
  { k: "2007", v: "경기도 안성, 송영신목장" },
];

export function StorySection() {
  return (
    <section id="story" className="overflow-hidden bg-paper-2">
      {/* Facts strip */}
      <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-8 sm:pt-32">
        <Reveal className="text-center">
          <p className="eyebrow">Why A2 Jersey</p>
          <h2 className="mx-auto mt-6 max-w-2xl font-serif-kr text-[clamp(1.9rem,4.4vw,3.2rem)] font-medium leading-[1.25] text-ink">
            같은 우유가 아닙니다.{" "}
            <span className="font-display italic text-gold">시작이 다른 우유</span>입니다.
          </h2>
        </Reveal>
        <div className="mt-16 grid grid-cols-2 gap-y-12 border-y border-line py-16 sm:grid-cols-4">
          {FACTS.map((f, i) => (
            <Reveal key={f.k} delay={i * 80} className="text-center">
              <p className="font-display text-[clamp(2rem,4vw,3.2rem)] font-medium text-gold">
                {f.k}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{f.v}</p>
            </Reveal>
          ))}
        </div>
      </div>

      {/* Outbound band → brand home */}
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 sm:px-8 sm:py-28 lg:grid-cols-2 lg:gap-20">
        <Reveal className="order-2 lg:order-1">
          <p className="eyebrow">The Farm</p>
          <h3 className="mt-5 font-serif-kr text-[clamp(1.6rem,3vw,2.4rem)] font-medium leading-snug text-ink">
            더 깊은 이야기는
            <br />
            <span className="font-display italic text-gold">목장의 본가에서.</span>
          </h3>
          <p className="mt-6 max-w-md text-[15px] leading-loose text-ink-soft">
            매일 같은 손이 젖을 짜고, 그날 안에 가공해 보냅니다. 목장의 풍경과 사람,
            저지소의 이야기는 송영신목장 공식 홈페이지에 담겨 있습니다.
          </p>
          <a
            href={BRAND_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-ink/20 bg-cream px-7 py-3.5 text-sm font-medium tracking-wide text-ink transition-colors hover:border-gold hover:text-gold-deep"
          >
            목장 이야기 보기 →
          </a>
        </Reveal>
        <Reveal delay={120} className="order-1 lg:order-2">
          <a
            href={BRAND_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block aspect-[4/5] overflow-hidden rounded-3xl bg-paper-3"
          >
            <Image
              src="/brand/jerseycow.png"
              alt="송영신목장의 A2 저지소"
              fill
              sizes="(max-width:1024px) 100vw, 50vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
