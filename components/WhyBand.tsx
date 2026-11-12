import { CertList } from "./CertList";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";
import { BRAND_HOME } from "@/lib/site";

// 사기 전에 알아야 할 것만 — 이름 풀이 · 신선도 · 인증.
//   홈에는 이 한 밴드만 남긴다. 예전에는 이름 풀이·희소성·재생농업·토양 미생물·세계 낙농
//   소식이 상품 목록과 구독 안내 사이사이에 놓여 모바일 홈이 화면 17장 길이였다.
//   나머지 이야기는 지우지 않고 /story 로 옮겼다(브랜드 홈페이지로도 잇는다).
//
//   ⚠ 여기 문장은 새로 지은 것이 없다 — 기존 화면(이름 풀이 밴드·제품 목록·신뢰 배지)에
//     있던 문구를 그대로 옮겼다. 효능·질병 관련 단정은 쓰지 않는다.
const WORDS = [
  { word: "A2", lead: "A1 단백질 없는 우유", sub: "100% A2 베타카제인" },
  { word: "Jersey", lead: "더 진하고 고소한 우유", sub: "유지방·단백질이 높은 품종" },
  { word: "Hay Milk", lead: "풀의 영양을 담은 우유", sub: "사일리지 없이 풀과 건초로" },
  { word: "Fresh", lead: "아침에 짜서, 다음 날 발송", sub: "콜드체인 냉장배송 · 0–10℃" },
] as const;

export function WhyBand() {
  const certIds = activeCertifications(kstYmd(new Date().toISOString())).map((c) => c.id);
  return (
    <section id="provenance" className="scroll-mt-20 bg-paper">
      <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="eyebrow text-center text-gold-deep">A2 Jersey Hay Milk</p>
        <h2 className="t-title2 mt-3 text-center font-serif-kr font-medium text-ink">
          이름에 다 적어 두었습니다.
        </h2>
        {/* 히어로에 있던 문장. 첫 화면을 상품에 내주면서 이리로 옮겼다 — 지우지 않는다. */}
        <p className="t-footnote mt-4 text-center leading-relaxed text-ink-soft">
          하루 500리터만 생산합니다.
          <br />더 만들 수 있지만, 그러지 않습니다.
        </p>

        <dl className="mt-9 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
          {WORDS.map(({ word, lead, sub }) => (
            <div key={word} className="text-center">
              <dt className="t-title2 font-display font-medium leading-none tracking-[-0.01em] text-ink">
                {word}
              </dt>
              <dd className="mt-2.5">
                <span className="t-footnote block font-medium text-ink-soft">{lead}</span>
                <span className="t-caption mt-1 block leading-relaxed text-mute">{sub}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 border-t border-line pt-9">
          <p className="t-caption uppercase tracking-[0.2em] text-mute">국가·기관 인증</p>
          <div className="mt-4">
            <CertList initialIds={certIds} />
          </div>
          <p className="t-caption mt-4 leading-relaxed text-mute">
            모두 목장(젖소 사육·착유 단계)에 대한 인증이며, 인증서 원본은 요청하시면 보여 드립니다.
          </p>
        </div>

        <p className="mt-8 text-center">
          <a
            href={BRAND_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="t-footnote inline-flex min-h-11 items-center text-gold-deep underline underline-offset-4"
          >
            목장과 철학 이야기는 브랜드 홈페이지에서 →
          </a>
        </p>
      </div>
    </section>
  );
}
