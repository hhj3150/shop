import Image from "next/image";

export function FarmBand() {
  return (
    <section className="relative w-full overflow-hidden bg-ink">
      {/* 세로 비율(1122×1402) 제품 컷을 잘림 없이 전부 보여준다.
          데스크톱은 폭을 제한해 가운데 정렬(애플식 집중 구도), 모바일은 풀폭.
          어두운 배경 위에 제품을 띄우고 하단 그라데이션 + 미니멀 캡션. */}
      <div className="relative mx-auto w-full max-w-[600px]">
        <Image
          src="/brand/story-podium.jpg"
          alt="송영신목장 A2 저지 헤이밀크 4종 제품 컷"
          width={1122}
          height={1402}
          sizes="(max-width:600px) 100vw, 600px"
          priority
          className="h-auto w-full"
        />

        {/* 하단 텍스트 가독용 그라데이션 (이미지 위에만, 사이드 여백엔 영향 없음) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent" />

        {/* 브랜드 로고 */}
        <Image
          src="/brand/haymil_log.png"
          alt=""
          aria-hidden
          width={800}
          height={800}
          className="pointer-events-none absolute right-4 top-5 z-10 w-14 drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)] sm:right-6 sm:top-6 sm:w-16"
        />

        {/* 캡션 — 하단 중앙 정렬, 미니멀 */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-9 text-center sm:px-8 sm:pb-11">
          <p className="font-display text-[13px] uppercase tracking-[0.32em] text-cream/75 sm:text-[14px]">
            Anseong · Made by Soil
          </p>
          <h2 className="mt-3 font-serif-kr text-[clamp(1.7rem,6vw,2.6rem)] font-medium leading-[1.16] text-cream">
            풀과 건초로 기른 <span className="text-gold">100% A2 저지.</span>
          </h2>
          <p className="mt-3 text-[14px] tracking-wide text-cream/65">
            경기도 안성 송영신목장에서 매주 갓 짜냅니다.
          </p>
        </div>
      </div>
    </section>
  );
}
