import Link from "next/link";
import { Reveal } from "./Reveal";

const STEPS = [
  { n: "01", t: "제품과 요일 선택", d: "주 1회 배송, 화요일·목요일 중 택일." },
  { n: "02", t: "최소 8회 구독", d: "한 번 신청하면 8회. 콜드체인으로 갓 짜낸 우유가 문 앞까지." },
  { n: "03", t: "자동 반복", d: "매주 같은 요일 자동 결제·배송. 8회 이후 언제든 해지." },
];

export function SubscriptionBand() {
  return (
    <section id="subscribe" className="relative overflow-hidden bg-ink py-24 text-cream sm:py-32">
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gold/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="eyebrow text-gold">Subscription</p>
          <h2 className="mt-5 font-serif-kr text-[clamp(2rem,4.5vw,3.4rem)] font-medium leading-tight">
            냉장고에 늘, <span className="font-display italic text-gold">목장의 아침.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-loose text-cream/70">
            장 보러 가지 않아도 신선함이 떨어지지 않게. 정기구독은 매 회차{" "}
            <span className="text-gold">10% 할인</span>, 배송비 무료. 주 1회, 화·목 중 원하는
            요일에 받아보세요.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-10 sm:grid-cols-3">
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
            href="/#products"
            className="mt-14 inline-flex rounded-full bg-cream px-9 py-4 text-sm font-medium tracking-wide text-ink transition-transform hover:scale-[1.03]"
          >
            구독할 제품 고르기
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
