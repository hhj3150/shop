import { FAQ_ITEMS } from "@/lib/seo/faq";

// 보이는 Q&A 섹션 — FAQ JsonLd(buildFAQPage)와 '같은 데이터'를 사람에게도 그대로 노출한다.
//   정적 서버 컴포넌트라 전체 문답이 HTML 에 박혀, 검색·생성형 엔진(ChatGPT·퍼플렉시티)이
//   목장을 '답'으로 인용하기 좋다(GEO). 구조화데이터와 화면 내용이 일치 → 신뢰·정합성 ↑.
export function FaqSection() {
  return (
    <section id="faq" className="bg-white">
      <div className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-20">
        <p className="eyebrow text-center text-gold-deep">Questions &amp; Answers</p>
        <h2 className="mt-3 text-center font-serif-kr text-[clamp(1.5rem,4vw,2.1rem)] font-medium tracking-[-0.01em] text-ink">
          자주 묻는 질문
        </h2>
        <p className="mx-auto mt-4 max-w-md text-center text-[14px] leading-relaxed text-mute">
          A2·저지·헤이밀크가 처음이시라면, 아래에서 차근히 살펴보세요.
        </p>

        <dl className="mt-10 divide-y divide-line/70">
          {FAQ_ITEMS.map((it) => (
            <div key={it.question} className="py-5">
              <dt className="font-serif-kr text-[16px] font-medium leading-snug text-ink">
                {it.question}
              </dt>
              <dd className="mt-2 text-[14px] leading-relaxed text-ink-soft">{it.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
