import Image from "next/image";
import { Reveal } from "./Reveal";

const FACTS = [
  { k: "1.6%", v: "국내 A2/A2 저지소 비율" },
  { k: "Hay-fed", v: "사일리지 없는 건초 급여" },
  { k: "0 첨가물", v: "우유와 유산균, 그뿐" },
  { k: "2007", v: "경기도 안성, 송영신목장" },
];

export function StorySection() {
  return (
    <section id="story" className="overflow-hidden bg-paper-2">
      {/* Editorial intro */}
      <div className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
        <Reveal>
          <p className="eyebrow">Why A2 Jersey</p>
          <h2 className="mt-6 font-serif-kr text-[clamp(2rem,4.6vw,3.4rem)] font-medium leading-[1.25] text-ink">
            같은 우유가 아닙니다.
            <br />
            <span className="font-display italic text-gold">시작이 다른 우유</span>입니다.
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-[15px] leading-loose text-ink-soft">
            저지소의 원유는 단백질과 유지방이 더 짙습니다. 그중에서도 A2/A2 유전형만 골라,
            소화가 편안한 A2 단백질의 우유만 담았습니다. 시작이 다르면, 맛도 다릅니다.
          </p>
        </Reveal>
      </div>

      {/* Facts strip */}
      <div className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
        <div className="grid grid-cols-2 gap-y-12 border-y border-line py-16 sm:grid-cols-4">
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

      {/* Two-up editorial */}
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-28 sm:px-8 lg:grid-cols-2 lg:gap-20">
        <Reveal className="order-2 lg:order-1">
          <p className="eyebrow">From the farm</p>
          <h3 className="mt-5 font-serif-kr text-[clamp(1.6rem,3vw,2.4rem)] font-medium leading-snug text-ink">
            짓는 사람의 손이
            <br />
            <span className="font-display italic text-gold">맛을 결정합니다.</span>
          </h3>
          <p className="mt-6 text-[15px] leading-loose text-ink-soft">
            매일 같은 시간, 같은 손이 젖을 짭니다. 갓 짜낸 원유는 그날 안에 살균·발효되어
            냉장 그대로 식탁에 도착합니다. 중간 유통을 줄일수록, 우유는 목장의 맛에 가까워집니다.
          </p>
          <ul className="mt-8 space-y-3 text-[14px] text-ink-soft">
            {["당일 착유 · 당일 가공", "콜드체인 직배송", "HACCP · 동물복지 인증 목장"].map(
              (t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                  {t}
                </li>
              )
            )}
          </ul>
        </Reveal>
        <Reveal delay={120} className="order-1 lg:order-2">
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-paper-3">
            <Image
              src="/brand/jerseycow.png"
              alt="송영신목장의 A2 저지소"
              fill
              sizes="(max-width:1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
