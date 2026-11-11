import type { Metadata } from "next";
import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { HowToBuy } from "@/components/HowToBuy";
import { WhyBand } from "@/components/WhyBand";
import { ConciergeInvite } from "@/components/ConciergeInvite";
import { SubscriptionBand } from "@/components/SubscriptionBand";
import { FaqSection } from "@/components/FaqSection";
import { VisitStore } from "@/components/VisitStore";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { buildLocalBusiness, buildFAQPage } from "@/lib/seo/schema";
import { FAQ_ITEMS } from "@/lib/seo/faq";

// 홈의 대표 주소와 검색 제목.
//   · canonical: 홈만 빠져 있었다(제품·안내·약관은 이미 있다). 없으면 ?ref=… 같은 꼬리표가
//     붙은 주소가 따로 색인될 수 있다.
//   · 제목: 예전 제목에는 손님이 실제로 검색하는 말(A2 우유·저지·정기구독)이 한글로 없었다.
//     효능 표현은 넣지 않는다 — 품목·품종·사육 방식·판매 방식만.
export const metadata: Metadata = {
  title: { absolute: "송영신목장 A2 저지 헤이밀크 | A2 우유·요거트 정기구독" },
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <JsonLd data={buildLocalBusiness()} />
      <JsonLd data={buildFAQPage(FAQ_ITEMS)} />
      <Hero />
      {/* 상품이 먼저다 — 인사 바로 아래. 이름 풀이·이야기는 사는 길 뒤로 보낸다. */}
      <ProductShowcase />
      <HowToBuy />
      <SubscriptionBand />
      <WhyBand />
      <ConciergeInvite />
      <FaqSection />
      <VisitStore />
      <Footer />
    </>
  );
}
