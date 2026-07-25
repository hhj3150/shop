import Link from "next/link";
import { BRAND_HOME } from "@/lib/site";

// 반려식물전용퇴비 애프터밀크 섹션(랜딩 후보).
//   카피 출처: 홈페이지(www.a2jerseymilk.com) After Milk 섹션 + 제품 패키지.
//   포지셔닝: 글로벌 프리미엄 반려식물 브랜드 문법(COMPO·Bloomscape 등) 벤치마킹 —
//     Plant Parent 감성 · Living Soil 네이밍 · 기능은 아이콘으로(Strong Roots,
//     Balanced Moisture, Organic, Zero Waste) · 천연 원료 리스트 강조.
//   ※ 효능 단정 금지 원칙 준수 — 식물 관련 기능은 패키지 표기 사실 범위,
//     M. vaccae는 일반 과학 개념 소개로만 다룬다(장–뇌 축 박스와 같은 패턴).

// 기능 아이콘 4종 — 글로벌 브랜드들의 아이콘 문법(💧🌱🌿♻)을 브랜드 선으로 그린다.
const FEATURES: {
  en: string;
  ko: string;
  desc: string;
  color: string;
  icon: React.ReactNode;
}[] = [
  {
    en: "Strong Roots",
    ko: "튼튼한 뿌리",
    desc: "뿌리를 튼튼하게 하는 유익균과 유기물",
    color: "var(--color-hey-green)",
    icon: (
      // 새싹 + 뿌리
      <path
        d="M12 11v9 M12 11c0-4 3-6.5 7-7-0.5 4-3 6.5-7 7Z M12 13c-.5-3-2.5-5-6-5.5.5 3.5 2.5 5 6 5.5Z M12 20c-2 0-3-1.5-5-1.5 M12 20c2 0 3-1.5 5-1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    en: "100% Organic",
    ko: "천연 유기물",
    desc: "화학비료 제로 · Grassfed 유기물",
    color: "var(--color-hey-orange)",
    icon: (
      // 잎사귀
      <path
        d="M5 19C5 9 12 4 19 4c0 8-4 14-12 14 M5 19c3-4 6-7 10-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    en: "Balanced Moisture",
    ko: "천천히, 6개월",
    desc: "물을 줄 때마다 양분이 서서히",
    color: "var(--color-hey-blue)",
    icon: (
      // 물방울
      <path
        d="M12 3s6 6.5 6 10.5a6 6 0 1 1-12 0C6 9.5 12 3 12 3Z M9.5 13.5a2.8 2.8 0 0 0 2.5 3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    en: "Zero Waste",
    ko: "순환의 흙",
    desc: "버리는 것 제로, 목장의 순환에서",
    color: "var(--color-hey-deep-orange)",
    icon: (
      // 순환 화살표
      <path
        d="M6 8a7 7 0 0 1 12-1.5 M18 3.5v3.5h-3.5 M18 16a7 7 0 0 1-12 1.5 M6 20.5V17h3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

// 천연 원료 리스트 — 글로벌 브랜드의 Compost·Biochar·Coco Coir 나열 문법.
const INGREDIENTS = [
  "Grassfed Compost · 목초 사육 유기물",
  "Beneficial Microbes · 유익균",
  "Macro & Micro Elements · 대량·미량원소",
  "Peat Moss Bedding · 피트모스 발효",
];

export function AftermilkBand() {
  return (
    <section className="w-full bg-paper-2">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          After Milk · Living Soil for Plant Parents
        </p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.9rem,5vw,2.6rem)] font-medium leading-[1.15] text-ink">
          반려식물전용퇴비 <span className="text-gold-deep">애프터밀크</span>
        </h2>

        <div className="mt-6 space-y-2.5 text-[clamp(1.05rem,2.4vw,1.3rem)] font-medium leading-relaxed text-ink-soft">
          <p>우유가 끝이 아닙니다. 순환이 시작됩니다.</p>
          <p>식물 집사의 실내정원, 집 안 화분의 모든 반려식물을 위한 살아 있는 흙.</p>
          <p className="text-ink">튼튼한 뿌리를 내려주렴 — After Milk.</p>
        </div>

        {/* 기능 4가지 — 아이콘 그리드(Strong Roots · Organic · Moisture · Zero Waste) */}
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.en}
              className="rounded-2xl border border-line bg-cream px-4 py-5"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: `color-mix(in srgb, ${f.color} 14%, transparent)` }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={f.color}
                  strokeWidth="1.6"
                  aria-hidden
                >
                  {f.icon}
                </svg>
              </span>
              <p className="mt-3 font-display text-[11px] uppercase tracking-[0.14em] text-gold-deep">
                {f.en}
              </p>
              <p className="mt-1 text-[14.5px] font-medium leading-snug text-ink">{f.ko}</p>
              <p className="mt-1 text-[12px] leading-snug text-mute">{f.desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
          초지에서 자란 풀이 소를 먹이고, 소가 만든 우유는 사람에게 — 남은 것은 다시 대지로
          돌아갑니다. 화학 사료를 먹지 않은 소의 분뇨를 피트모스 베딩 시스템으로 발효한, 퇴비
          전문가들 사이에서 &lsquo;전설&rsquo;이라 불리는 고품질 유기물 파우더입니다.
        </p>

        {/* 천연 원료 — 화학성분 대신 원료를 앞세우는 글로벌 문법 */}
        <div className="mt-6 flex flex-wrap gap-2">
          {INGREDIENTS.map((ing) => (
            <span
              key={ing}
              className="rounded-full border border-line bg-cream px-3.5 py-1.5 text-[12.5px] text-ink-soft"
            >
              {ing}
            </span>
          ))}
        </div>

        {/* 흙 속의 미생물 — Mycobacterium vaccae 소개(일반 과학 개념 + 효능 단정 금지) */}
        <div className="mt-8 rounded-2xl border border-gold/40 bg-gold/5 p-6">
          <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            <span
              aria-hidden
              style={{ backgroundColor: "var(--color-hey-green)" }}
              className="h-1.5 w-1.5 rounded-full"
            />
            Mycobacterium vaccae · 흙 속의 미생물
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            건강한 흙에는 <em className="not-italic font-medium text-ink">M. vaccae</em> 같은
            토양 미생물이 살고 있습니다. 흙을 만지고 식물을 돌보는 시간이 마음에 좋은 영향을
            준다는 연구들에서 주목받아 온 미생물입니다. 화분 곁의 작은 정원이 곧 자연과의
            연결 — 우리가 실내정원의 흙부터 돌보는 이유입니다.
          </p>
          <p className="mt-3 text-[11.5px] text-mute">
            ※ 일반 과학 개념의 소개이며, 특정 성분의 함량이나 질병의 예방·치료 효능을 뜻하지
            않습니다.
          </p>
        </div>

        {/* 이렇게 쓰세요 — 패키지 STEP 안내 그대로 */}
        <div className="mt-8 rounded-2xl border border-line bg-cream p-6">
          <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            <span
              aria-hidden
              style={{ backgroundColor: "var(--color-hey-blue)" }}
              className="h-1.5 w-1.5 rounded-full"
            />
            이렇게 쓰세요
          </p>
          <ol className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-soft">
            <li>
              <strong className="text-ink">STEP 1.</strong> 흙(상토) 9 : 파우더 1 비율로 골고루
              섞어 주세요.
            </li>
            <li>
              <strong className="text-ink">STEP 2.</strong> 식물을 바로 심을 수 있습니다.
              분갈이할 때도 같은 비율로.
            </li>
            <li>
              <strong className="text-ink">STEP 3.</strong> 물을 주면 6개월간 유기물과 양분이
              천천히 공급됩니다.
            </li>
          </ol>
          <p className="mt-3 text-[11.5px] text-mute">
            직사광선을 피해 서늘한 곳에 보관하면 10년 이상 사용할 수 있습니다.
          </p>
        </div>

        {/* CTA — 제품 상세로. 홈페이지 After Milk 이야기 링크도 함께. */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/products/aftermilk-1l"
            className="inline-flex items-center rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-cream transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            애프터밀크 구매하기
          </Link>
          <a
            href={BRAND_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
          >
            목장의 순환 이야기 보기 ↗
          </a>
        </div>
      </div>
    </section>
  );
}
