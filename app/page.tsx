import { Hero } from "@/components/Hero";
import { WhatItMeans } from "@/components/WhatItMeans";
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
      <Hero />
      {/* 제품을 보기 전에 이름부터 푼다 — 모르는 낱말 셋으로는 값이 설명되지 않는다. */}
      <WhatItMeans />
      <ProductShowcase />
      <ConciergeInvite />
      <FarmBand />
      <Provenance />
      <RegenerativeBand />
      <NewsBand />
      <NewsRadarBand />
      <SubscriptionBand />
      <FaqSection />
      <VisitStore />
      <Footer />
    </>
  );
}
