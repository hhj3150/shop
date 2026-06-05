import Image from "next/image";
import Link from "next/link";
import { Reveal } from "./Reveal";
import { SlotAvailability } from "./SlotAvailability";
import { SocialProof } from "./SocialProof";

const STEPS = [
  {
    n: "01",
    t: "요일을 정합니다",
    d: "월–금 중 하루. 그날 새벽 갓 짜낸 한 병이 곧장 문 앞에.",
    color: "var(--color-hey-rose)",
  },
  {
    n: "02",
    t: "기간만큼, 한 번에",
    d: "4·8·12주분을 한 번 입금. 약속한 요일마다 채워 드립니다. 매번 결제는 없습니다.",
    color: "var(--color-hey-green)",
  },
  {
    n: "03",
    t: "창립 500인의 특권",
    d: "기간이 길수록 커지는 회원가 10–15%. 부담 없이, 원하는 만큼.",
    color: "var(--color-hey-blue)",
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
            건강하게 내어주는 만큼만 짜기에, 모시는 분도 정해 두었습니다 — 요일마다 100분,
            다섯 요일 통틀어 <span className="text-gold">오직 500분</span>. 자리가 차면 대기
            순으로, 비는 날 가장 먼저 안내드립니다.
          </p>
          <SlotAvailability />
          <SocialProof variant="dark" />
        </Reveal>

        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div
                style={{ borderTopColor: s.color, borderTopWidth: 2 }}
                className="border-t border-cream/20 pt-6"
              >
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
