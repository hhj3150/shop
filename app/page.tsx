import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { FarmBand } from "@/components/FarmBand";
import { NewsBand } from "@/components/NewsBand";
import { SubscriptionBand } from "@/components/SubscriptionBand";
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
      <NewsBand />
      <SubscriptionBand />
      <VisitStore />
      <Footer />
    </>
  );
}
