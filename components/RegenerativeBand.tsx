// 재생농업 스토리 밴드(랜딩). 우리 목소리로 쓴 가치 서사 + Kiss the Ground는
//   '함께 보면 좋은 곳'으로 출처 링크만(로고·파트너 표방 없음 — KTG 브랜드 가이드 준수).
//   ※ 건강 '효능' 단정은 쓰지 않는다(원유 성분·농법·가치 관점).

// 외부 자료 링크(공개 페이지). 제휴 아님 — 영감을 받은 곳으로 소개.
const KTG_HOME = "https://kisstheground.com/";
const KTG_PRINCIPLES =
  "https://kisstheground.com/education/resources/regenerative-principles-guide/";

export function RegenerativeBand() {
  return (
    <section className="w-full bg-paper">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          Regenerative · From Soil to Soul
        </p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.9rem,5vw,2.6rem)] font-medium leading-[1.15] text-ink">
          건강한 흙, <span className="text-gold-deep">건강한 우유</span>.
        </h2>

        <div className="mt-6 space-y-2.5 text-[clamp(1.05rem,2.4vw,1.3rem)] font-medium leading-relaxed text-ink-soft">
          <p>땅을 쓰는 농사가 아니라, 되살리는 농사.</p>
          <p>건초를 중심으로. 사일리지는 없습니다.</p>
          <p className="text-ink">흙에서 마음까지 — From Soil to Soul.</p>
        </div>

        {/* 이 밴드의 마침표. 제품 이야기에는 From Soil to Soul, 목장 이야기 끝에는 이 문장. */}
        <p className="mt-8 font-display text-[clamp(1.2rem,3vw,1.6rem)] font-medium tracking-[-0.01em] text-ink">
          Save our soil, <span className="text-mute">save us.</span>
        </p>

        {/* 원칙 — 자연이 허락한 만큼 (HEY 액센트 포인트) */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { line: "자연이 허락한 만큼.", color: "var(--color-hey-green)" },
            { line: "토양과 소의 건강.", color: "var(--color-hey-orange)" },
            { line: "미생물의 건강.", color: "var(--color-hey-blue)" },
          ].map(({ line, color }) => (
            <div
              key={line}
              style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              className="rounded-2xl border border-line bg-cream px-5 py-4 text-[15px] font-medium text-ink"
            >
              <span
                aria-hidden
                style={{ backgroundColor: color }}
                className="mb-2.5 block h-2 w-2 rounded-full"
              />
              {line}
            </div>
          ))}
        </div>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
          미생물이 건강해야 땅이, 소가, 우리가 건강합니다.
        </p>

        {/* 함께 보면 좋은 곳 — Kiss the Ground (출처 링크, 제휴 아님) */}
        <div className="mt-10 rounded-2xl border border-line bg-cream p-6">
          <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            <span
              aria-hidden
              style={{ backgroundColor: "var(--color-hey-green)" }}
              className="h-1.5 w-1.5 rounded-full"
            />
            함께 보면 좋은 곳
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            흙을 되살리는 일이 곧 기후와 먹거리를 살리는 길.{" "}
            <strong className="text-ink">Kiss the Ground</strong>는 그 길을 걷는 비영리 단체입니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={KTG_HOME}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              Kiss the Ground 알아보기 ↗
            </a>
            <a
              href={KTG_PRINCIPLES}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              재생농업 원칙 가이드 ↗
            </a>
          </div>
          <p className="mt-3 text-[11.5px] text-mute">
            제휴 아님 · 같은 가치에서 영감을 받아 소개합니다.
          </p>
        </div>
      </div>
    </section>
  );
}
