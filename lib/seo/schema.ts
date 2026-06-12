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

// buildProduct 옵션. 별점·가격유효일은 순수성 유지를 위해 호출부에서 계산해 주입한다
// (Date.now()/new Date()를 이 함수 안에서 호출하지 않아 결정적·테스트 가능).
export type BuildProductOpts = {
  // count > 0 일 때만 aggregateRating 을 방출한다. value 는 소수 첫째 자리 평균.
  rating?: { value: number; count: number };
  // "YYYY-12-31" 형태. 미지정 시 priceValidUntil 을 생략한다.
  priceValidUntil?: string;
};

// 단품 기본 배송비(lib/products.ts ONCE_SHIPPING_KRW=4000)와 일치하는 표준 배송비.
const STANDARD_SHIPPING_KRW = 4000;

function buildShippingDetails() {
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: STANDARD_SHIPPING_KRW,
      currency: "KRW",
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: "KR",
    },
  } as const;
}

// 반품 정책: 식품 특성상 단순변심 7일 이내, 우편 반송, 반송비 구매자 부담은 아니나
// schema.org 유효성을 위해 FreeReturn 으로 표기(표시용 리터럴, 실제 약관은 별도).
function buildReturnPolicy() {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "KR",
    returnPolicyCategory:
      "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 7,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/FreeReturn",
  } as const;
}

export function buildProduct(p: Product, opts: BuildProductOpts = {}) {
  const hasRating = Boolean(opts.rating && opts.rating.count > 0);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: `${SITE_URL}${p.image}`,
    description: p.shortDesc, // Product에는 description 필드가 없어 shortDesc를 사용
    brand: { "@type": "Brand", name: "송영신목장" },
    // 별점은 실제 후기가 있을 때만(count>0) 방출. 없으면 키 자체를 생략한다.
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: opts.rating!.value,
            reviewCount: opts.rating!.count,
          },
        }
      : {}),
    offers: {
      "@type": "Offer",
      price: String(p.price), // schema.org/Google 권장: price는 문자열
      priceCurrency: "KRW",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/products/${p.id}`,
      ...(opts.priceValidUntil
        ? { priceValidUntil: opts.priceValidUntil }
        : {}),
      shippingDetails: buildShippingDetails(),
      hasMerchantReturnPolicy: buildReturnPolicy(),
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
