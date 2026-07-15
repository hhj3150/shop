import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { ConciergeInvite } from "@/components/ConciergeInvite";
import { FarmBand } from "@/components/FarmBand";
import { Provenance } from "@/components/Provenance";
import { RegenerativeBand } from "@/components/RegenerativeBand";
import { NewsBand } from "@/components/NewsBand";
import { NewsRadarBand } from "@/components/NewsRadarBand";
import { SubscriptionBand } from "@/components/SubscriptionBand";
import { FaqSection } from "@/components/FaqSection";
import { VisitStore } from "@/components/VisitStore";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { buildLocalBusiness, buildFAQPage } from "@/lib/seo/schema";
import { FAQ_ITEMS } from "@/lib/seo/faq";

export default function Home() {
  return (
    <>
      <JsonLd data={buildLocalBusiness()} />
      <JsonLd data={buildFAQPage(FAQ_ITEMS)} />
      {/* 구매 동선 우선 배치: 히어로 → 제품 → 구독 방법(잔여석·신청)까지를 최상단에 붙이고,
          브랜드 스토리·소식 밴드는 그 뒤로. (구매사이트 제1원칙 — 스토리는 구매를 뒷받침) */}
      <Hero />
      <ProductShowcase />
      <SubscriptionBand />
      <ConciergeInvite />
      <FarmBand />
      <Provenance />
      <RegenerativeBand />
      <NewsBand />
      <NewsRadarBand />
      <FaqSection />
      <VisitStore />
      <Footer />
    </>
  );
}
