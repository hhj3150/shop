import Image from "next/image";

// 세로 비율(1122×1402) 제품 컷을 잘림 없이 전부 보여준다.
//   - 모바일: 풀폭 이미지 + 하단 그라데이션 위 캡션 오버레이(에디토리얼).
//   - 데스크톱: 이미지 | 캡션 2단 분할 — 세로 사진을 넓은 화면에서 안정적으로 배치
//     (가운데 다크 여백이 크게 비지 않도록), 애플식 집중 구도.
export function FarmBand() {
  const EYEBROW = "Anseong · Made by Soil";
  const SUB = "갓 짜낸 그대로, 다음 날 식탁으로.";

  return (
    <section className="relative w-full overflow-hidden bg-ink">
      <div className="mx-auto grid max-w-6xl items-center lg:grid-cols-2">
        {/* 제품 이미지 — 전체(잘림 없음) */}
        <div className="relative">
          <Image
            src="/brand/story-podium.jpg"
            alt="송영신목장 A2 저지 헤이밀크 4종 제품 컷"
            width={1122}
            height={1402}
            sizes="(max-width:1024px) 100vw, 50vw"
            className="h-auto w-full"
          />

          {/* 브랜드 로고 */}
          <Image
            src="/brand/haymil_log.png"
            alt=""
            aria-hidden
            width={800}
            height={800}
            className="pointer-events-none absolute right-4 top-5 z-10 w-14 drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)] sm:right-6 sm:top-6 sm:w-16"
          />

          {/* 모바일 전용: 하단 그라데이션 + 캡션 오버레이 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent lg:hidden" />
          <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-9 text-center lg:hidden">
            <p className="font-display text-[13px] uppercase tracking-[0.32em] text-cream/75 sm:text-[14px]">
              {EYEBROW}
            </p>
            <h2 className="mt-3 font-serif-kr text-[clamp(1.7rem,6vw,2.4rem)] font-medium leading-[1.16] text-cream">
              풀과 건초로 기른 <span className="text-gold">100% A2 저지.</span>
            </h2>
            <p className="mt-3 text-[14px] tracking-wide text-cream/65">{SUB}</p>
          </div>
        </div>

        {/* 데스크톱 전용: 우측 캡션 */}
        <div className="hidden flex-col justify-center px-12 py-16 lg:flex xl:px-16">
          <p className="font-display text-[14px] uppercase tracking-[0.34em] text-cream/70">
            {EYEBROW}
          </p>
          <h2 className="mt-5 font-serif-kr text-[clamp(2rem,3vw,3rem)] font-medium leading-[1.18] text-cream">
            풀과 건초로 기른
            <br />
            <span className="text-gold">100% A2 저지.</span>
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-cream/65">{SUB}</p>
        </div>
      </div>
    </section>
  );
}
