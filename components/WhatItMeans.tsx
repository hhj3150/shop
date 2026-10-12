// 제품명을 풀어 주는 밴드 — "A2 저지 헤이밀크"의 세 단어가 무슨 뜻인지.
//
//   [왜] 손님은 제품명을 읽고도 뜻을 모른다. 모르는 낱말이 셋 붙어 있으면
//     "왜 비싼지"가 전달되지 않는다. 값을 설명하기 전에 말을 먼저 풀어야 한다.
//     히어로 바로 아래 둔다 — 워드마크에서 그 세 단어를 본 직후이기 때문이다.
//
//   ⚠ 효능·질병 관련 단정은 쓰지 않는다. 품종·성분·사육방식의 사실 서술만.
const WORDS = [
  {
    word: "A2",
    lead: "A1 단백질 없는 우유",
    sub: "100% A2 베타카제인",
  },
  {
    word: "Jersey",
    lead: "더 진하고 고소한 우유",
    sub: "유지방·단백질이 높은 품종",
  },
  {
    word: "Hay Milk",
    lead: "풀의 영양을 담은 우유",
    sub: "깨끗한 맛 · 유럽 전통 헤이밀크",
  },
] as const;

export function WhatItMeans() {
  return (
    <section className="w-full bg-paper">
      <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
        <p className="text-center font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          A2 Jersey Hay Milk
        </p>
        <h2 className="mt-3 text-center font-serif-kr text-[clamp(1.4rem,3.4vw,1.9rem)] font-medium leading-snug text-ink">
          이름에 다 적어 두었습니다.
        </h2>

        <dl className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {WORDS.map(({ word, lead, sub }) => (
            <div key={word} className="text-center">
              <dt className="font-display text-[clamp(1.7rem,4vw,2.2rem)] font-medium leading-none tracking-[-0.01em] text-ink">
                {word}
              </dt>
              <dd className="mt-3">
                <span className="block text-[15px] font-medium text-ink-soft sm:text-[15.5px]">
                  {lead}
                </span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-mute">
                  {sub}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
