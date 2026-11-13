import Image from "next/image";

// 세로 비율(1122×1402) 제품 컷을 잘림 없이 전부 보여준다.
//   - 모바일: 풀폭 이미지 + 하단 그라데이션 위 캡션 오버레이(에디토리얼).
//   - 데스크톱: 이미지 | 캡션 2단 분할 — 세로 사진을 넓은 화면에서 안정적으로 배치
//     (가운데 다크 여백이 크게 비지 않도록), 애플식 집중 구도.
// titleAs: 캡션 제목 태그. /story 에서는 이 띠가 첫 화면이라 h1(페이지 제목)로 쓴다.
//   캡션은 한 벌만 둔다 — 예전에는 모바일·데스크톱 캡션 두 벌이 모두 h1 이라 /story 에 h1 이 둘이었다
//   (2026-11-12 운영 감사). 지금은 같은 격자 칸 겹침으로 배치만 바꾼다: 모바일은 사진 아래쪽에 겹치고
//   (사진과 같은 칸, 아래 정렬), 데스크톱은 오른쪽 칸.
export function FarmBand({ titleAs: Title = "h2" }: { titleAs?: "h1" | "h2" } = {}) {
  const EYEBROW = "Anseong · Made by Soil";
  const SUB = "아침에 짠 원유, 다음 날 콜드체인으로.";

  return (
    <section className="relative w-full overflow-hidden bg-ink">
      <div className="mx-auto grid max-w-6xl items-center lg:grid-cols-2">
        {/* 제품 이미지 — 전체(잘림 없음) */}
        <div className="relative col-start-1 row-start-1">
          <Image
            src="/brand/farm-herd.webp"
            alt="골든아워, 목장 들판에 선 송영신목장 A2 저지 젖소 무리"
            width={1300}
            height={2157}
            sizes="(max-width:1024px) 100vw, 50vw"
            className="h-auto w-full"
          />

          {/* 브랜드 로고 */}
          <Image
            src="/brand/logo-label.png"
            alt=""
            aria-hidden
            width={1000}
            height={793}
            sizes="64px"
            className="pointer-events-none absolute right-4 top-5 z-10 w-14 drop-shadow-[0_6px_16px_rgba(0,0,0,0.35)] sm:right-6 sm:top-6 sm:w-16"
          />

          {/* 모바일 전용: 캡션 뒤 하단 그라데이션 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent lg:hidden" />
        </div>

        {/* 캡션(한 벌) — 모바일: 사진 위 하단 오버레이 / 데스크톱: 오른쪽 칸 */}
        <div className="relative z-10 col-start-1 row-start-1 self-end px-6 pb-9 text-center lg:col-start-2 lg:self-center lg:px-12 lg:py-16 lg:text-left xl:px-16">
          <p className="font-display text-[13px] uppercase tracking-[0.32em] text-cream/75 sm:text-[14px] lg:tracking-[0.34em] lg:text-cream/70">
            {EYEBROW}
          </p>
          <Title className="mt-3 font-serif-kr text-[clamp(1.7rem,6vw,2.4rem)] font-medium leading-[1.16] text-cream lg:mt-5 lg:text-[clamp(2rem,3vw,3rem)] lg:leading-[1.18]">
            건초를 먹여 기른{" "}
            <br />
            <span className="text-gold">100% A2 저지.</span>
          </Title>
          <p className="mt-3 text-[14px] tracking-wide text-cream/65 lg:mt-5 lg:max-w-sm lg:text-[15px] lg:leading-relaxed lg:tracking-normal">
            {SUB}
          </p>
        </div>
      </div>
    </section>
  );
}
