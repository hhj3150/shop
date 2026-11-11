import type { Metadata } from "next";
import { Provenance } from "@/components/Provenance";
import { FarmBand } from "@/components/FarmBand";
import { RegenerativeBand } from "@/components/RegenerativeBand";
import { NewsBand } from "@/components/NewsBand";
import { NewsRadarBand } from "@/components/NewsRadarBand";
import { Footer } from "@/components/Footer";

// 목장 이야기 — 홈에서 사는 길 밖으로 옮긴 읽을거리.
//   품종의 희소성 · 재생농업 · 목장 소식 · 세계 낙농 소식. 내용은 홈에 있던 그대로다
//   (지우지 않고 자리를 옮겼다). 홈은 상품과 사는 방법에 집중한다.
export const metadata: Metadata = {
  title: "목장 이야기",
  description:
    "송영신목장이 A2 저지를 풀과 건초로 기르는 방식, 재생농업, 목장 소식과 세계 낙농 소식.",
  alternates: { canonical: "/story" },
};

export default function StoryPage() {
  return (
    <>
      <div className="pt-16">
        <FarmBand />
      </div>
      <Provenance />
      <RegenerativeBand />
      <NewsBand />
      <NewsRadarBand />
      <Footer />
    </>
  );
}
