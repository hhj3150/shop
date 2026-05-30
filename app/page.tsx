import { Hero } from "@/components/Hero";
import { ProductShowcase } from "@/components/ProductShowcase";
import { SubscriptionBand } from "@/components/SubscriptionBand";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Hero />
      <ProductShowcase />
      <SubscriptionBand />
      <Footer />
    </>
  );
}
