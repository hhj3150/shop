import { Reveal } from "./Reveal";
import { CertList } from "./CertList";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";

// 수치의 근거(2026-11-11 사장님 제공): 국내 젖소 약 40만 두 · 그중 저지 약 1,200두 ·
//   낙농 목장 약 5,000곳 중 A2 저지 단일 품종 착유목장은 송영신목장 한 곳(저지 60두).
//   공식 통계 출처·기준 연도는 아직 붙이지 않았다 — '약'을 붙여 적는다.
const STATS = [
  { v: "약 40만 두", l: "국내 젖소 · 대부분 홀스타인" },
  { v: "약 1,200두", l: "그중 저지" },
  { v: "단 한 곳", l: "국내 유일 A2 저지 목장" },
];

export function Provenance() {
  const certIds = activeCertifications(kstYmd(new Date().toISOString())).map((c) => c.id);
  return (
    <section id="rarity" className="border-y border-line bg-paper-2/40">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <Reveal className="max-w-2xl">
          <p className="eyebrow text-gold-deep">Rarity</p>
          <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,4vw,2.6rem)] font-medium leading-tight text-ink">
            드문 데는, 이유가 있습니다.
          </h2>
          <p className="mt-5 text-[14px] leading-loose text-ink-soft sm:text-[15px]">
            국내 젖소 약 40만 두는 대부분 홀스타인입니다. 저지는 약 1,200두.
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
                <p className="mt-2 text-[14px] tracking-wide text-ink-soft">{s.l}</p>
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
                A2 베타카제인만 지닌 원유입니다. A1 베타카제인은 들어 있지 않습니다.
              </p>
            </div>
            <div>
              <p className="font-display text-[13px] uppercase tracking-[0.2em] text-gold-deep">
                Hay-Fed
              </p>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
                발효사료 없이, 풀과 건초를 중심으로. 유럽이 전통특산물(TSG)로 지키는 헤이밀크의 방식을 따릅니다.
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
            {/* 이름만 적은 칩에서 '명칭·발급기관·번호·유효기간'으로 — 인증은 확인할 수 있어야 인증이다.
                목록은 lib/certifications.ts 한 곳에서 오고, 기간이 지난 것은 저절로 빠진다. */}
            <div className="mt-4">
              <CertList initialIds={certIds} />
            </div>
            <p className="mt-4 text-[12.5px] leading-relaxed text-mute">
              모두 목장(젖소 사육·착유 단계)에 대한 인증이며, 인증서 원본은 요청하시면 보여 드립니다.
            </p>
            <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
              ※ A2·헤이밀크 관련 설명은 공개된 연구 자료에 근거한 일반 정보이며, 질병의
              예방·치료 효과를 의미하지 않습니다.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
