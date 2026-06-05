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
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
        <p className="font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          Regenerative · From Soil to Soul
        </p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.7rem,5vw,2.4rem)] font-medium leading-[1.2] text-ink">
          건강한 흙에서 <span className="text-gold-deep">건강한 우유</span>가 옵니다.
        </h2>

        <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-soft">
          <p>
            송영신목장이 걷는 길은 <strong className="text-ink">재생농업(Regenerative
            Agriculture)</strong>입니다. 땅을 쓰기만 하는 농사가 아니라, 농사를 지을수록 흙이
            더 살아나게 하는 방식이지요.
          </p>
          <p>
            건강한 흙은 더 깊은 뿌리와 풍부한 미생물을 품습니다. 그 위에서 자란 풀과 잘 말린
            건초가 우리 소를 기릅니다. 발효사료(사일리지)를 쓰지 않고 풀·건초로만 기르는
            헤이밀크 방식은, 소에게는 본연의 식이를, 우유에는 맑고 진한 풍미와 더 나은 지방산
            균형(오메가-3·CLA)을 남깁니다.
          </p>
          <p>
            흙 → 풀 → 소 → 우유 → 우리 식탁. 한 병의 우유는 이 순환의 한 조각입니다. 흙을
            건강하게 돌볼수록 그 우유를 마시는 가족과 땅이 함께 건강해진다고 믿습니다.{" "}
            <span className="text-ink">From Soil to Soul — 흙에서 마음까지.</span>
          </p>
        </div>

        {/* 함께 보면 좋은 곳 — Kiss the Ground (출처 링크, 제휴 아님) */}
        <div className="mt-10 rounded-2xl border border-line bg-cream p-6">
          <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            함께 보면 좋은 곳
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            재생농업과 토양 건강을 알리는 미국의 비영리 단체{" "}
            <strong className="text-ink">Kiss the Ground</strong>는, 흙을 되살리는 일이 곧
            기후와 먹거리를 살리는 길임을 이야기합니다. 같은 가치를 추구하는 분들께 권합니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={KTG_HOME}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              Kiss the Ground 알아보기 ↗
            </a>
            <a
              href={KTG_PRINCIPLES}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              재생농업 원칙 가이드 ↗
            </a>
          </div>
          <p className="mt-3 text-[11.5px] text-mute">
            외부 사이트로 이동합니다. 송영신목장은 Kiss the Ground와 제휴 관계가 아니며,
            같은 가치에서 영감을 받아 소개합니다.
          </p>
        </div>
      </div>
    </section>
  );
}
