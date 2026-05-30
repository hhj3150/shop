import { Reveal } from "./Reveal";

const STATS = [
  { v: "38만 두", l: "국내 젖소 · 대부분 홀스타인" },
  { v: "1,000여 두", l: "그중 저지" },
  { v: "단 한 곳", l: "100% A2 저지 착유목장" },
];

const CERTS = [
  "저탄소 인증 1호",
  "동물복지 인증 1호",
  "HACCP 인증",
  "경기도 가축행복농장",
  "깨끗한목장 인증",
];

export function Provenance() {
  return (
    <section id="provenance" className="border-y border-line bg-paper-2/40">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <Reveal className="max-w-2xl">
          <p className="eyebrow text-gold-deep">Rarity</p>
          <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
            드문 데는, 이유가 있습니다.
          </h2>
          <p className="mt-5 text-[14px] leading-loose text-ink-soft sm:text-[15px]">
            국내 젖소 38만 두는 대부분 홀스타인입니다. 저지는 1,000여 두.
            그중 100% A2 저지만 골라, 사일리지 없이 풀과 건초로 기릅니다 —
            알프스가 수백 년 이어온 헤이밀크의 방식 그대로.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {STATS.map((s, i) => (
            <Reveal key={s.l} delay={i * 80}>
              <div className="flex h-full flex-col items-center justify-center bg-paper px-6 py-10 text-center">
                <p className="font-serif-kr text-[clamp(1.8rem,4vw,2.6rem)] font-medium text-gold-deep tabular-nums">
                  {s.v}
                </p>
                <p className="mt-2 text-[14px] tracking-wide text-mute">{s.l}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={140}>
          <div className="mt-10 grid gap-x-12 gap-y-8 border-t border-line pt-9 sm:grid-cols-3">
            <div>
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
                A2 / A2
              </p>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                A2 베타카세인만 지닌 원유. 소화 과정에서 펩타이드 BCM-7을 만들지 않습니다.
              </p>
            </div>
            <div>
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
                Hay-Fed
              </p>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                발효사료 없이 풀과 건초만. 유럽이 전통특산물(TSG)로 지키는 헤이밀크의 방식입니다.
              </p>
            </div>
            <div>
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
                Jersey
              </p>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                전체 젖소의 한 줌뿐인 희소 품종. 진한 유지방과 깊은 풍미가 한 병에 담깁니다.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={200}>
          <div className="mt-10">
            <p className="text-[13px] uppercase tracking-[0.2em] text-mute">
              국가·기관 인증
            </p>
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {CERTS.map((c) => (
                <li
                  key={c}
                  className="rounded-full border border-gold/40 bg-gold/8 px-4 py-2 text-[14px] font-medium text-gold-deep"
                >
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12.5px] leading-relaxed text-mute">
              모든 인증은 정식 인증번호를 보유하고 있으며, 요청 시 확인해 드립니다.
            </p>
            <p className="mt-3 text-[11.5px] leading-relaxed text-mute/80">
              ※ A2·헤이밀크 관련 설명은 공개된 연구 자료에 근거한 일반 정보이며, 질병의
              예방·치료 효과를 의미하지 않습니다.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
