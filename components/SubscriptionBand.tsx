import Image from "next/image";
import Link from "next/link";
import { Reveal } from "./Reveal";
import { BLOCK_WEEKS, SUB_MIN_DELIVERIES } from "@/lib/products";

const STEPS = [
  {
    n: "01",
    t: "요일을 정합니다",
    d: "월·화·수·목·금 가운데 한 요일. 그 요일마다 매주 한 번, 목장에서 갓 짜낸 한 병이 문 앞에 닿습니다.",
  },
  {
    n: "02",
    t: `${BLOCK_WEEKS}주분을 먼저 모십니다`,
    d: `${BLOCK_WEEKS}주분(${SUB_MIN_DELIVERIES}회)을 무통장으로 먼저 입금해 주시면, 확인되는 즉시 첫 발송을 준비합니다.`,
  },
  {
    n: "03",
    t: "오래 함께할수록",
    d: `6개월 이상 ${15}%, 1년 이상 ${20}% — 곁에 오래 두실수록 더 귀하게 모십니다. ${SUB_MIN_DELIVERIES}회 이후 언제든 해지하실 수 있습니다.`,
  },
];

export function SubscriptionBand() {
  return (
    <section id="subscribe" className="relative overflow-hidden bg-ink py-16 text-cream sm:py-24">
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
            <span className="font-display italic text-gold">귀한 분께만.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-loose text-cream/70">
            가입과 결제를 조금 까다롭게 둔 것은 일부러입니다. 매주 한 병까지 정성으로
            모시려면, 모실 수 있는 분의 수를 먼저 정해야 했습니다. 요일별 선착순 100분,
            다섯 요일 통틀어 <span className="text-gold">단 500분</span>. 자리가 차면
            대기로 모시고, 한 자리가 비면 가장 먼저 안내드립니다.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div className="border-t border-cream/20 pt-6">
                <p className="font-display text-3xl text-gold">{s.n}</p>
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
