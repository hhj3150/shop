import { Reveal } from "./Reveal";

const STATS = [
  { v: "38만 두", l: "국내 전체 젖소" },
  { v: "1,000여 두", l: "그중 저지소" },
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
            희소함은 흉내 낼 수 없습니다.
          </h2>
          <p className="mt-5 text-[14px] leading-loose text-ink-soft sm:text-[15px]">
            국내 젖소 38만 두 가운데 저지소는 1,000여 두뿐. 그중 100% A2 저지만으로
            착유하는 목장은 — 현재까지 — 우리가 유일합니다.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
          {STATS.map((s, i) => (
            <Reveal key={s.l} delay={i * 80}>
              <div className="flex h-full flex-col items-center justify-center bg-paper px-6 py-10 text-center">
                <p className="font-serif-kr text-[clamp(1.8rem,4vw,2.6rem)] font-medium text-gold-deep tabular-nums">
                  {s.v}
                </p>
                <p className="mt-2 text-[13px] tracking-wide text-mute">{s.l}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="mt-10">
            <p className="text-[12px] uppercase tracking-[0.2em] text-mute">
              국가·기관 인증
            </p>
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {CERTS.map((c) => (
                <li
                  key={c}
                  className="rounded-full border border-gold/40 bg-gold/8 px-4 py-2 text-[13px] font-medium text-gold-deep"
                >
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12.5px] leading-relaxed text-mute">
              모든 인증은 정식 인증번호를 보유하고 있으며, 요청 시 확인해 드립니다.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
