import { BUSINESS, BRAND_HOME, SITE_URL } from "@/lib/site";
import type { Product } from "@/lib/products";
import type { FaqItem } from "./faq";

// 모든 빌더는 부수효과 없는 순수 함수. JSON-LD 평문 객체를 반환한다.
// 사업자/주소/연락처는 lib/site.ts, 제품은 인자로 받은 Product에서만 읽는다.

export function buildOrganization() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BUSINESS.company,
    url: SITE_URL,
    logo: `${SITE_URL}/brand/heymilk-logo.png`,
    sameAs: [BRAND_HOME],
  } as const;
}

export function buildWebSite() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "송영신목장 · A2 Jersey Hay Milk",
    url: SITE_URL,
    inLanguage: "ko-KR",
  } as const;
}

export function buildLocalBusiness() {
  // openingHours·priceRange는 lib/site.ts에 없는 표시용 리터럴(SSOT 아님).
  return {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "Farm"],
    name: "송영신목장",
    url: SITE_URL,
    telephone: BUSINESS.tel,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address,
      addressCountry: "KR",
    },
    // 운영시간은 app/guide/page.tsx의 "평일 10:00–17:00 (점심 12:00–13:00)"와 일치(SSOT 아님).
    openingHours: ["Mo-Fr 10:00-12:00", "Mo-Fr 13:00-17:00"],
    priceRange: "₩₩", // 표시 리터럴(SSOT 아님)
  } as const;
}

export function buildProduct(p: Product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: `${SITE_URL}${p.image}`,
    description: p.shortDesc, // Product에는 description 필드가 없어 shortDesc를 사용
    brand: { "@type": "Brand", name: "송영신목장" },
    offers: {
      "@type": "Offer",
      price: String(p.price), // schema.org/Google 권장: price는 문자열
      priceCurrency: "KRW",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/products/${p.id}`,
    },
  } as const;
}

export function buildFAQPage(items: readonly FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  } as const;
}
