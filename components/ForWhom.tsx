import { Reveal } from "./Reveal";

const FOR = [
  {
    t: "속이 불편해 우유를 멀리하신 분",
    d: "A2 단백질만 지닌 저지 원유. 우유를 사랑하지만 마시지 못했던 분들을 위한 한 병.",
  },
  {
    t: "진정한 우유의 풍미를 아는 분",
    d: "건초로 키운 저지소에서만 나오는 깊고 고소한 풍미. 한 모금에 차이를 느낍니다.",
  },
  {
    t: "우리 아이의 첫 우유로",
    d: "가장 맑고 정직한 한 잔을, 가장 소중한 첫 경험으로 모십니다.",
  },
  {
    t: "귀한 손자에게 보내는 마음",
    d: "멀리 있어도 건강만은 곁에. 매주 한 병의 안부를 대신 전합니다.",
  },
  {
    t: "어르신과 환자분의 건강식",
    d: "소화가 편안한 A2, 부담 없이 매일 챙기실 수 있는 단백질과 영양.",
  },
  {
    t: "미식가의 식탁 위에",
    d: "와인을 고르듯 우유를 고르는 분께. 한정 생산하는 최고급 미식품.",
  },
];

export function ForWhom() {
  return (
    <section id="for-whom" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
      <Reveal className="max-w-2xl">
        <p className="eyebrow text-gold-deep">For Whom</p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
          이런 분의 식탁에 닿기를.
        </h2>
      </Reveal>

      <div className="mt-12 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {FOR.map((f, i) => (
          <Reveal key={f.t} delay={(i % 3) * 80}>
            <div className="border-t border-line pt-5">
              <h3 className="font-serif-kr text-[17px] leading-snug text-ink">{f.t}</h3>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">{f.d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
