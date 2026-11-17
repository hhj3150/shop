import type { Metadata } from "next";
import { FarmWalk } from "./FarmWalk";

// 목장 산책 — 게임으로 보는 쇼핑몰(독립 섹션).
//   기존 스토어 구조는 손대지 않는다: 이 라우트는 어디에서도 링크되지 않아도
//   /play 로 직접 진입해 체험할 수 있고, 상품 정보는 lib/products.ts SSOT를 그대로 읽는다.
export const metadata: Metadata = {
  title: "목장 산책",
  description:
    "흙에서 우유까지, 걸어서 만나는 송영신목장. A2 저지 헤이밀크와 플레인 요거트를 게임으로 만나 보세요.",
  alternates: { canonical: "/play" },
};

export default function PlayPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <p className="eyebrow text-gold-deep">Farm Walk</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.6rem,4vw,2.2rem)] font-medium tracking-[-0.01em] text-ink">
        목장 산책
      </h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-mute">
        흙에서 우유까지, 걸어서 만나는 송영신목장. 네 병을 모두 만나면 산책이
        완성됩니다.
      </p>
      <FarmWalk />
      <p className="mt-4 text-[12px] leading-relaxed text-mute">
        가고 싶은 곳을 탭하거나, 방향키(WASD)로 걷습니다. 표지판에 가까이 가면
        이야기와 상품이 열립니다.
      </p>
    </div>
  );
}
