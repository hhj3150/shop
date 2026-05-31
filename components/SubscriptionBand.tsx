import Image from "next/image";
import Link from "next/link";
import { Reveal } from "./Reveal";
import { SlotAvailability } from "./SlotAvailability";

const STEPS = [
  {
    n: "01",
    t: "요일을 정합니다",
    d: "월·화·수·목·금 가운데 단 하루. 그 요일 새벽 목장에서 갓 짜낸 한 병이, 어디도 거치지 않고 곧장 문 앞에 닿습니다.",
  },
  {
    n: "02",
    t: "한 달치를 한 번에",
    d: "한 달분(매주 한 병 × 4주)을 무통장으로 한 번 입금해 주시면, 확인되는 즉시 첫 병을 준비합니다. 매번의 결제 없이 약속한 요일마다 채워 드립니다.",
  },
  {
    n: "03",
    t: "창립 500인의 특권",
    d: "선착순 창립 500인 회원께만 드리는 특권 — 늘 10% 회원가로 모십니다. 한 달씩 가볍게, 원하실 때까지 부담 없이 이어집니다.",
  },
];

export function SubscriptionBand() {
  return (
    <section id="subscribe" className="relative scroll-mt-20 overflow-hidden bg-ink py-16 text-cream sm:py-24">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gold/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />
      <Image
        src="/brand/haymil_log.png"
        alt=""
        aria-hidden
        width={800}
        height={800}
        className="pointer-events-none absolute -bottom-10 -right-8 w-56 opacity-[0.22] sm:-bottom-14 sm:-right-10 sm:w-80"
      />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="eyebrow text-gold">Members Only</p>
          <h2 className="mt-5 font-serif-kr text-[clamp(2rem,4.5vw,3.4rem)] font-medium leading-tight">
            모두에게 열지 않았습니다,{" "}
            <span className="gold-foil font-display italic">귀한 분께만.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-loose text-cream/70">
            가입을 조금 까다롭게 둔 것은, 욕심내지 않기 위해서입니다. 젖소가 건강하게
            내어주는 만큼만 짜고, 그날 짠 우유는 그날 길을 나섭니다. 늘릴 수 없는
            양이기에 모시는 분도 미리 정해 두었습니다 — 요일마다 단 100분, 다섯 요일을
            통틀어 <span className="text-gold">오직 500분</span>. 자리가 차면 대기 순으로
            모시고, 한 자리가 비는 날 가장 먼저 안내드립니다.
          </p>
          <SlotAvailability />
        </Reveal>

        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div className="border-t border-cream/20 pt-6">
                <p className="gold-foil font-display text-3xl">{s.n}</p>
                <h3 className="mt-3 font-serif-kr text-lg">{s.t}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-cream/65">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <Link
            href="/signup"
            className="mt-12 inline-flex rounded-full bg-cream px-9 py-4 text-sm font-medium tracking-wide text-ink transition-transform hover:scale-[1.03]"
          >
            회원으로 모시기 →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
