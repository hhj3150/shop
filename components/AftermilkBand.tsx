import { BRAND_HOME } from "@/lib/site";

// 반려식물전용퇴비 aftermilk 섹션(랜딩 후보).
//   - 홈페이지(www.a2jerseymilk.com)의 aftermilk 섹션과 같은 세계관: 목장의 순환
//     (우유를 만들고 남은 것이 다시 흙으로) — RegenerativeBand의 서사를 잇는다.
//   - 카피는 홈페이지 원문 대조 전 초안. 원문 확정 시 문구만 교체하면 된다.
//   - ※ 비료 '효능' 단정은 쓰지 않는다(순환·원료·사용 경험 관점).
export function AftermilkBand() {
  return (
    <section className="w-full bg-paper-2">
      <div className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="font-display text-[13px] uppercase tracking-[0.32em] text-gold-deep sm:text-[14px]">
          Aftermilk · From Milk to Soil
        </p>
        <h2 className="mt-4 font-serif-kr text-[clamp(1.9rem,5vw,2.6rem)] font-medium leading-[1.15] text-ink">
          반려식물전용퇴비 <span className="text-gold-deep">aftermilk</span>
        </h2>

        <div className="mt-6 space-y-2.5 text-[clamp(1.05rem,2.4vw,1.3rem)] font-medium leading-relaxed text-ink-soft">
          <p>우유가 지나간 자리, 흙으로 돌아갑니다.</p>
          <p>목장의 순환에서 온 반려식물 전용 퇴비.</p>
          <p className="text-ink">우유에서 흙으로 — From Milk to Soil.</p>
        </div>

        {/* 특징 3가지 — HEY 액센트 포인트(재생농업 밴드와 동일 패턴) */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { line: "저지 목장의 순환 원료.", color: "var(--color-hey-green)" },
            { line: "발효와 숙성은 충분히.", color: "var(--color-hey-orange)" },
            { line: "실내 반려식물에 맞게.", color: "var(--color-hey-blue)" },
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
          건강한 흙에서 우유가 나오고, 우유를 만들고 남은 것이 다시 흙이 됩니다. aftermilk는 그
          순환의 마지막이자, 반려식물 화분에서 시작되는 새로운 처음입니다.
        </p>

        {/* 이렇게 쓰세요 — 사용 안내 */}
        <div className="mt-8 rounded-2xl border border-gold/40 bg-gold/5 p-6">
          <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            <span
              aria-hidden
              style={{ backgroundColor: "var(--color-hey-green)" }}
              className="h-1.5 w-1.5 rounded-full"
            />
            이렇게 쓰세요
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            화분 흙 위에 얇게 얹어 주기만 하면 됩니다. 물을 줄 때마다 양분이 천천히 스며들어,
            반려식물의 흙을 조금씩 살립니다.
          </p>
          <p className="mt-3 text-[11.5px] text-mute">
            ※ 실내 화분용 소량 포장 기준의 안내이며, 자세한 사용법은 제품과 함께 보내 드립니다.
          </p>
        </div>

        {/* 안내 + 홈페이지 링크 — 쇼핑몰 입점 전 소개 단계 */}
        <div className="mt-10 rounded-2xl border border-line bg-cream p-6">
          <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            <span
              aria-hidden
              style={{ backgroundColor: "var(--color-hey-orange)" }}
              className="h-1.5 w-1.5 rounded-full"
            />
            쇼핑몰 입점 준비 중
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            <strong className="text-ink">aftermilk</strong>는 쇼핑몰 입점을 준비하고 있습니다.
            지금은 목장 홈페이지에서 먼저 만나 보실 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={BRAND_HOME}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              홈페이지에서 aftermilk 보기 ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
