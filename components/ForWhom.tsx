import { Reveal } from "./Reveal";

const FOR = [
  {
    t: "속이 편치 않아 멀리하셨다면",
    d: "A2 단백질만 지닌 저지 원유입니다. 우유를 좋아하지만 마시지 못하던 분들이 다시 찾습니다.",
  },
  {
    t: "우유 본래의 맛을 아는 분께",
    d: "건초로 키운 저지소의 원유에서만 나오는 깊고 고소한 결. 한 모금이면 충분합니다.",
  },
  {
    t: "아이의 첫 우유로",
    d: "가장 맑은 한 잔을, 가장 처음의 기억으로 두는 일.",
  },
  {
    t: "멀리 있는 손주에게",
    d: "곁을 지키지 못하는 날에도, 매주 한 병이 안부를 대신합니다.",
  },
  {
    t: "어르신과 회복기의 식탁에",
    d: "소화가 편안한 A2. 매일 부담 없이 챙기는 단백질과 영양입니다.",
  },
  {
    t: "맛을 아는 분의 식탁에",
    d: "한 해에 내어드릴 수 있는 양이 정해져 있습니다. 아는 분만 조용히 찾으십니다.",
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
