import { Reveal } from "./Reveal";

const PILLARS = [
  {
    k: "15년",
    t: "준비한 시간",
    d: "대한민국에 진짜 프리미엄 우유를 세우기 위해, 15년을 한길로 준비했습니다.",
  },
  {
    k: "365일",
    t: "곁을 지키는 하루",
    d: "1년 365일, 하루도 거르지 않고 소의 건강과 컨디션을 먼저 살핍니다.",
  },
  {
    k: "30년",
    t: "수의사의 손",
    d: "30년 경력의 대동물 수의사가 직접 목장을 운영합니다. 진단부터 사양까지, 손수.",
  },
];

export function Maker() {
  return (
    <section id="maker" className="border-t border-line bg-cream">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-8 sm:py-24">
        <Reveal>
          <p className="eyebrow text-gold-deep">The Maker</p>
          <h2 className="mx-auto mt-5 max-w-3xl font-serif-kr text-[clamp(1.7rem,4vw,2.7rem)] font-medium leading-[1.3] text-ink">
            좋은 우유는 좋은 하루에서 나옵니다.
            <br />
            <span className="font-display italic text-gold-deep">
              그 하루를, 30년 수의사가 지킵니다.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-[14px] leading-loose text-ink-soft sm:text-[15px]">
            소가 편안해야 우유가 정직해집니다. 사람의 편의가 아니라 소의 하루를 기준으로
            목장을 운영하는 이유입니다. 좋은 것은 보이지 않는 곳에서 완성됩니다.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.k} delay={i * 90}>
              <div className="flex h-full flex-col items-center bg-paper px-6 py-10">
                <p className="font-display text-[clamp(2.2rem,5vw,3rem)] leading-none text-gold-deep">
                  {p.k}
                </p>
                <h3 className="mt-3 font-serif-kr text-[16px] text-ink">{p.t}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-ink-soft">{p.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
