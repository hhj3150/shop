import type { Metadata } from "next";
import { AftermilkBand } from "@/components/AftermilkBand";

// aftermilk 섹션 점검용 미리보기 — 검수 후 app/page.tsx(랜딩)에 배치 예정.
//   랜딩 반영이 끝나면 이 라우트는 삭제한다. sitemap에는 포함하지 않는다.
export const metadata: Metadata = {
  title: "aftermilk 섹션 미리보기",
  robots: { index: false, follow: false },
};

export default function AftermilkPreviewPage() {
  return (
    <>
      {/* 고정 Nav(fixed top) 아래로 내리기 위한 상단 여백 — Hero의 pt-28 관례를 따른다. */}
      <div className="border-b border-line bg-cream px-5 pt-24 pb-3 text-center text-[13px] text-mute sm:pt-28">
        섹션 미리보기 — 검수 후 랜딩에 추가됩니다.
      </div>
      <AftermilkBand />
    </>
  );
}
