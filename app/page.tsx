import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
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
      <ProductShowcase />
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
