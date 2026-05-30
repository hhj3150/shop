import { Reveal } from "./Reveal";

const NOTES = [
  {
    k: "A2 / A2",
    t: "저지, 그리고 A2 단백질",
    d: "국내 1.6%에 불과한 A2/A2 저지소의 원유만을 씁니다. A2 베타카세인은 단백질 사슬의 67번 자리에 프롤린이 있어, 소화 과정에서 일부 사람이 불편을 느끼게 한다고 알려진 펩타이드(BCM-7)를 거의 만들지 않습니다. 그래서 우유를 마신 뒤 속이 한결 편안하다고 느끼는 분이 많습니다.",
  },
  {
    k: "Hay-fed",
    t: "사일리지 없이, 풀과 건초만",
    d: "발효사료(사일리지)를 일절 먹이지 않고, 여름엔 신선한 풀과 허브를, 겨울엔 잘 말린 건초만 먹여 기릅니다. 알프스가 수백 년 이어온 헤이밀크(Heumilch)의 방식 — 유럽연합이 전통특산물(TSG)로 보호하는 그 기준 그대로입니다.",
  },
  {
    k: "Omega-3 · CLA",
    t: "풀이 만든 영양",
    d: "풀과 건초로 기른 소의 우유는, 빈 농생명대학의 연구에서 일반 우유보다 오메가-3 지방산과 공액리놀레산(CLA)이 약 두 배 더 풍부한 것으로 보고되었습니다. 들판의 식물 다양성이 그대로 한 병에 담깁니다.",
  },
  {
    k: "Taste",
    t: "잡미 없는 깨끗함",
    d: "사일리지 특유의 잡미가 없어 맛이 맑고, 더 진하면서도 은은하게 답니다. 이 깨끗한 원유는 그대로 마실 때는 물론, 요거트로 발효했을 때 그 깊이가 가장 선명하게 드러납니다.",
  },
];

export function WhyHayMilk() {
  return (
    <section className="border-t border-line bg-paper-2/40">
      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <p className="eyebrow text-gold-deep">Why A2 Jersey Hay Milk</p>
          <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
            왜 A2 저지 헤이밀크인가.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-x-12 gap-y-12 sm:grid-cols-2">
          {NOTES.map((n, i) => (
            <Reveal key={n.k} delay={i * 80}>
              <div className="border-t border-line pt-6">
                <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
                  {n.k}
                </p>
                <h3 className="mt-3 font-serif-kr text-lg text-ink">{n.t}</h3>
                <p className="mt-3 text-[14px] leading-loose text-ink-soft">{n.d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-12 text-[11.5px] leading-relaxed text-mute">
          ※ A2 단백질과 헤이밀크에 관한 설명은 공개된 연구 자료에 근거한 일반 정보이며,
          질병의 예방·치료 효과를 의미하지 않습니다.
        </p>
      </div>
    </section>
  );
}
