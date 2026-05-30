import { Hero } from "@/components/Hero";
import { Provenance } from "@/components/Provenance";
import { ProductShowcase } from "@/components/ProductShowcase";
import { ForWhom } from "@/components/ForWhom";
import { Maker } from "@/components/Maker";
import { SubscriptionBand } from "@/components/SubscriptionBand";
import { VisitStore } from "@/components/VisitStore";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Hero />
      <Provenance />
      <ProductShowcase />
      <ForWhom />
      <Maker />
      <SubscriptionBand />
      <VisitStore />
      <Footer />
    </>
  );
}
