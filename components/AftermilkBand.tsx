import Link from "next/link";
import { BRAND_HOME } from "@/lib/site";

// 반려식물전용퇴비 애프터밀크 섹션(랜딩 후보).
//   카피 출처: 홈페이지(www.a2jerseymilk.com) After Milk 섹션 + 제품 패키지.
//   포지셔닝: 실내정원·집 안 화분의 반려식물 전용 퇴비(Zero Waste Cycle의 마지막).
//   ※ 효능 단정 금지 원칙 준수 — M. vaccae는 일반 과학 개념 소개로만 다룬다
//     (RegenerativeBand의 장–뇌 축 박스와 같은 패턴).
export function AftermilkBand() {
  return (
    <section className="w-full bg-paper-2">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          After Milk · Zero Waste Cycle
        </p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.9rem,5vw,2.6rem)] font-medium leading-[1.15] text-ink">
          반려식물전용퇴비 <span className="text-gold-deep">애프터밀크</span>
        </h2>

        <div className="mt-6 space-y-2.5 text-[clamp(1.05rem,2.4vw,1.3rem)] font-medium leading-relaxed text-ink-soft">
          <p>우유가 끝이 아닙니다. 순환이 시작됩니다.</p>
          <p>실내정원, 집 안 화분의 모든 반려식물을 위한 전용 퇴비.</p>
          <p className="text-ink">튼튼한 뿌리를 내려주렴 — After Milk.</p>
        </div>

        {/* 특징 3가지 — HEY 액센트 포인트(재생농업 밴드와 동일 패턴) */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { line: "화학비료 제로, 버리는 것 제로.", color: "var(--color-hey-green)" },
            { line: "악취 대신 건강한 흙냄새.", color: "var(--color-hey-orange)" },
            { line: "한 번 사용으로 6개월.", color: "var(--color-hey-blue)" },
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
          초지에서 자란 풀이 소를 먹이고, 소가 만든 우유는 사람에게 — 남은 것은 다시 대지로
          돌아갑니다. 화학 사료를 먹지 않은 소의 분뇨를 피트모스 베딩 시스템으로 발효한, 퇴비
          전문가들 사이에서 &lsquo;전설&rsquo;이라 불리는 고품질 유기물 파우더입니다.
        </p>

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
