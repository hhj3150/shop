import Image from "next/image";
import Link from "next/link";
import { MembershipCounter } from "./MembershipCounter";
import { SubscribeFilmCTA } from "./SubscribeFilmCTA";

// 쇼핑몰의 첫 화면은 '사러 온 사람'의 화면이다.
//   예전 히어로는 화면 한 장을 통째로 썼고(슬로건·생산량·회원 수·버튼·제품 정렬컷),
//   실제로 살 수 있는 상품 카드는 그 아래 '이름 풀이' 밴드까지 지나야 나왔다.
//   2026-10-28~11-10 퍼널: 방문 756 세션 중 상품을 본 세션 313(41%).
//
//   · 모바일: 인사는 짧게 끝내고 바로 아래 상품 목록이 첫 화면에 걸리게 한다.
//     제품 정렬컷은 싣지 않는다 — 바로 밑 카드가 같은 병을 '살 수 있는 모양'으로 보여 준다.
//   · 데스크톱: 정렬컷을 옆에 두되 높이를 화면 한 장으로 잡지 않는다.
//   바탕은 종이색, 제품컷의 흰 배경은 .media-plate(곱셈 합성)로 녹인다.
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-paper">
      <div className="mx-auto grid max-w-7xl items-center gap-7 px-5 pt-20 pb-2 sm:px-8 sm:pt-28 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-0 lg:pt-24">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          {/* 워드마크 — 로고는 상단 바에 이미 있다. 브랜드명만 국문 + 골드포일 영문으로. */}
          <p className="mb-2 font-display text-[clamp(1.05rem,4.4vw,1.5rem)] font-medium leading-snug tracking-[0.01em] text-ink lg:mb-6">
            송영신목장{" "}
            <span className="gold-foil">A2 Jersey Hay Milk</span>
          </p>

          <h1 className="max-w-2xl text-balance font-serif-kr text-[clamp(1.45rem,3.4vw,2.5rem)] font-medium leading-[1.32] tracking-[-0.015em] text-ink">
            소중한 분들에게 최상의 우유를.
            <br />
            그리고 지속가능한 지구를.
          </h1>

          {/* 인사는 여기까지 — 워드마크·슬로건·회원 수·버튼. 1440×900 에서 상품 카드 사진이
              첫 화면에 들어오는 높이로 맞췄다. 문단을 더하거나 정렬컷을 키우면 다시 밀린다.
              ("하루 500리터만 생산합니다 …"는 지우지 않고 이름 풀이 밴드(WhyBand)로 옮겼다 —
              모바일에서는 #221 부터 이 자리에 보이지 않았다.) */}
          <div className="mt-4 lg:mt-7">
            <MembershipCounter />
          </div>

          {/* 데스크톱: 사는 문이 먼저(제품 보기), 구독 안내는 그다음.
              모바일: 버튼을 두지 않는다 — 상품 카드가 바로 아래에 있다. */}
          <div className="mt-6 hidden items-center gap-3 lg:flex">
            <Link
              href="/#products"
              className="rounded-full bg-ink px-9 py-4 text-center text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98]"
            >
              제품 보기
            </Link>
            <SubscribeFilmCTA className="rounded-full border border-ink/15 bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink-soft transition-[transform,border-color,color] duration-300 ease-[var(--ease-soft)] hover:border-gold hover:text-gold-deep active:scale-[0.98]" />
          </div>
        </div>

        {/* 제품 정렬컷(1487×1058) — 데스크톱 전용.
            ※ width/height 는 실제 파일 크기와 맞춘다(어긋나면 CLS). 모바일에서는 그리지 않으므로
              priority 를 걸지 않는다 — 걸면 보이지도 않는 그림을 모바일이 먼저 내려받는다. */}
        <div className="hidden justify-center lg:flex">
          <Image
            src="/brand/hero-row-white.webp"
            alt="송영신목장 A2 저지 헤이밀크 180mL·750mL 와 A2 저지 플레인요거트 180mL·500mL 제품 라인업"
            width={1487}
            height={1058}
            sizes="(max-width:1024px) 1px, 45vw"
            className="media-plate h-auto w-full max-w-[330px] object-contain"
          />
        </div>
      </div>
    </section>
  );
}
