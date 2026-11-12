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
import { buildLocalBusiness } from "@/lib/seo/schema";
import { pageMetadata } from "@/lib/seo/meta";
import { homeSeo } from "@/lib/seo/copy";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";

// 홈의 대표 주소·검색 제목·설명·공유 카드.
//   · canonical "/": ?ref=… 같은 꼬리표가 붙은 주소가 따로 색인되지 않게 한다.
//   · 제목: 브랜드명이 맨 앞(네이버 권고), 손님이 실제로 검색하는 말(A2 저지우유·요거트·정기배송)을
//     한 번씩만 — 같은 낱말 반복은 네이버 불이익. 효능 표현은 넣지 않는다.
//   · 문구는 lib/seo/copy.ts 에서 만든다(숫자·인증은 SSOT 에서).
const homeCopy = homeSeo(activeCertifications(kstYmd(new Date().toISOString())));
export const metadata: Metadata = pageMetadata({
  ...homeCopy,
  path: "/",
  absoluteTitle: true,
});

export default function Home() {
  return (
    <>
      <JsonLd data={buildLocalBusiness()} />
      {/* FAQPage 구조화데이터는 /faq 한 곳에만 둔다(같은 문답을 여러 페이지에 표시하지 않는다 — 구글 권고).
          홈의 FaqSection 은 사람에게 보이는 문답으로 그대로 둔다. */}
      <Hero />
      {/* 상품이 먼저다 — 인사 바로 아래. 이름 풀이·이야기는 사는 길 뒤로 보낸다. */}
      <ProductShowcase />
      <HowToBuy />
      <SubscriptionBand />
      <WhyBand />
      <ConciergeInvite />
      <FaqSection moreHref="/faq" />
      <VisitStore />
      <Footer />
    </>
  );
}
