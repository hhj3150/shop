import {
  BUSINESS,
  SITE_URL,
  BRAND,
  BRAND_CHANNELS,
  ADDRESS_PARTS,
  CS_HOURS,
  FARM_HOURS_SPEC,
} from "@/lib/site";
import { ONCE_SHIPPING_KRW, type Product } from "@/lib/products";
import type { Certification } from "@/lib/certifications";
import type { FaqItem } from "./faq";
import { ORG_DESCRIPTION, productSeo } from "./copy";

// 구조화데이터(JSON-LD) 빌더 — 모두 부수효과 없는 순수 함수, 평문 객체를 반환한다.
//
//   ★ 엔티티 그래프: 조직(#organization)·사이트(#website)·판매장(#farm-store)·제품(#product)이
//     '@id' 로 서로를 가리킨다. 예전에는 조직 이름이 법인명(디투오)이고 브랜드(송영신목장)와 연결이
//     없어, 검색·AI 가 '송영신목장'을 하나의 주체로 묶지 못했다.
//   ★ 화면과 같은 사실만 적는다(구글 정책: 구조화데이터는 보이는 내용과 일치해야 한다).
//     사업자·주소·연락처 = lib/site.ts, 제품 = lib/products.ts, 인증 = lib/certifications.ts(호출부 주입).
//   ★ 날짜(오늘)는 이 파일에서 만들지 않는다 — 호출부가 계산해 넣는다(결정적·테스트 가능).

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const STORE_ID = `${SITE_URL}/#farm-store`;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const abs = (path: string) => (path.startsWith("http") ? path : `${SITE_URL}${path}`);

/** "031-674-3150" → "+82-31-674-3150" (구조화데이터 권장 국제 표기). */
export function intlTel(tel: string): string {
  return `+82-${tel.replace(/^0/, "")}`;
}

function postalAddress() {
  // 우편번호는 확인 전이라 넣지 않는다(lib/site.ts ADDRESS_PARTS 주석).
  return {
    "@type": "PostalAddress",
    streetAddress: ADDRESS_PARTS.street,
    addressLocality: ADDRESS_PARTS.locality,
    addressRegion: ADDRESS_PARTS.region,
    addressCountry: "KR",
  } as const;
}

// 반품 정책: 신선식품(우유) 특성상 단순변심 청약철회가 제한된다(약관 제7조).
// 구조화데이터는 실제 약관과 일치해야 한다(허위 표기 시 구글 정책 위반·분쟁 위험) →
// 단순변심 반품 불가를 정확히 표기한다(MerchantReturnNotPermitted). 상세 기준은 /guide.
// 입금 후 배송준비 전 전액환불·구독 미배송분 환불·하자 교환은 별개로 약관·안내에서 설명한다.
function buildReturnPolicy() {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: "KR",
    returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted",
    merchantReturnLink: `${SITE_URL}/guide`,
  } as const;
}

/** 농장 인증 1건 → schema.org Certification. 모두 '농장' 인증이므로 조직(Organization)에만 붙인다. */
export function buildCertification(c: Certification) {
  return {
    "@type": "Certification",
    name: c.name,
    issuedBy: { "@type": "Organization", name: c.issuer },
    certificationIdentification: c.number,
    certificationStatus: "https://schema.org/CertificationActive",
    validFrom: c.validFrom,
    ...(c.validUntil ? { expires: c.validUntil } : {}),
    description: `인증 대상: ${c.scope}`,
  };
}

export type BuildOrganizationOpts = {
  /** 오늘(KST) 기준 유효한 인증만 넣는다 — activeCertifications(today). */
  certifications?: readonly Certification[];
};

export function buildOrganization(opts: BuildOrganizationOpts = {}) {
  const certs = opts.certifications ?? [];
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    // 손님이 아는 이름(브랜드)이 name, 법인명은 legalName — 둘이 같은 주체임을 한 노드에서 밝힌다.
    name: BRAND.name,
    legalName: BUSINESS.company,
    alternateName: [...BRAND.alternateNames],
    description: ORG_DESCRIPTION,
    url: SITE_URL,
    logo: {
      "@type": "ImageObject",
      url: `${SITE_URL}/brand/logo-label.png`,
      width: 1000,
      height: 793,
    },
    image: `${SITE_URL}/brand/og-default.jpg`,
    email: BUSINESS.email,
    telephone: intlTel(BUSINESS.tel),
    taxID: BUSINESS.bizNo,
    address: postalAddress(),
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer service",
        telephone: intlTel(BUSINESS.tel),
        email: BUSINESS.email,
        areaServed: "KR",
        availableLanguage: ["ko"],
        hoursAvailable: CS_HOURS.spec.map((s) => ({
          "@type": "OpeningHoursSpecification",
          dayOfWeek: WEEKDAYS,
          opens: s.opens,
          closes: s.closes,
        })),
      },
    ],
    sameAs: [...BRAND_CHANNELS],
    hasMerchantReturnPolicy: buildReturnPolicy(),
    ...(certs.length > 0 ? { hasCertification: certs.map(buildCertification) } : {}),
  };
}

export function buildWebSite() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    // 구글 '사이트 이름' — 짧은 브랜드명이 name, 나머지는 선호 순서대로 alternateName.
    name: BRAND.name,
    alternateName: [`${BRAND.name} ${BRAND.productLine}`, "A2 Jersey Hay Milk", "shop.a2jerseymilk.com"],
    url: SITE_URL,
    inLanguage: "ko-KR",
    publisher: { "@id": ORG_ID },
  };
}

/** 목장 판매장(방문 구매). 영업시간은 lib/site.ts FARM_HOURS_SPEC — 화면(VisitStore)과 같다. */
export function buildLocalBusiness() {
  return {
    "@context": "https://schema.org",
    // 'Farm' 은 schema.org 에 없는 타입이었다(schema.org/Farm 404). 손님이 와서 사는 곳 → Store.
    "@type": "Store",
    "@id": STORE_ID,
    name: BRAND.name,
    description: "경기도 안성 송영신목장 판매장. A2 저지 헤이밀크와 플레인 요거트를 판매합니다.",
    url: SITE_URL,
    image: `${SITE_URL}/brand/og-default.jpg`,
    telephone: intlTel(BUSINESS.tel),
    address: postalAddress(),
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [...FARM_HOURS_SPEC.days],
        opens: FARM_HOURS_SPEC.opens,
        closes: FARM_HOURS_SPEC.closes,
      },
    ],
    parentOrganization: { "@id": ORG_ID },
    priceRange: "₩₩", // 표시 리터럴(SSOT 아님)
  };
}

// buildProduct 옵션. 별점·가격유효일·재고는 순수성 유지를 위해 호출부에서 계산해 주입한다.
export type BuildProductOpts = {
  // count > 0 일 때만 aggregateRating 을 방출한다. value 는 소수 첫째 자리 평균.
  rating?: { value: number; count: number };
  // "YYYY-12-31" 형태. 미지정 시 priceValidUntil 을 생략한다.
  priceValidUntil?: string;
  // 품절·숨김이면 false. 미지정 시 판매 중(InStock).
  inStock?: boolean;
};

// 배송: 단품·구독 공통 기본 배송비(제주·도서산간 할증은 /guide·/faq 본문에서 안내).
//   할증 요율(5,000원)을 두 번째 OfferShippingDetails 로 더하지 않는다 — 구글 판매자 목록은 지역
//   구분(우편번호·행정구역)을 미국·호주·캐나다·일본 등에만 지원해, 한국에서는 '전국 요율 둘'로 읽힌다
//   (2026-11-12 운영 감사 검토 결과).
//   발송 규칙(app/order-once/page.tsx 안내문): 입금 확인 후 평일(월–목) 자정 전 주문은 다음 날,
//   금·토·일 주문은 월요일 발송 → 처리 1–3일. 택배 특성상 보통 발송 다음 날 수령 → 운송 1–2일.
function buildShippingDetails() {
  return {
    "@type": "OfferShippingDetails",
    shippingRate: {
      "@type": "MonetaryAmount",
      value: ONCE_SHIPPING_KRW,
      currency: "KRW",
    },
    shippingDestination: {
      "@type": "DefinedRegion",
      addressCountry: "KR",
    },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
    },
  } as const;
}

// 라벨(법정 표시사항) 중 사실 항목만 PropertyValue 로 — 화면 '제품표시사항'과 같은 값.
function productProperties(p: Product) {
  const rows: [string, string | undefined][] = [
    [p.line === "aftermilk" ? "제품유형" : "식품유형", p.label.type],
    ["원재료명 및 함량", p.label.ingredients],
    ["내용량", p.label.content],
    ["살균방법", p.label.sterilization],
    ["유산균수", p.label.cultures],
    ["보관방법", p.label.storage],
  ];
  return rows
    .filter((r): r is [string, string] => Boolean(r[1]))
    .map(([name, value]) => ({ "@type": "PropertyValue", name, value }));
}

export function buildProduct(p: Product, opts: BuildProductOpts = {}) {
  const url = `${SITE_URL}/products/${p.id}`;
  const hasRating = Boolean(opts.rating && opts.rating.count > 0);
  const images = p.gallery?.length ? p.gallery.map((g) => abs(g.src)) : [abs(p.image)];
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    // 용량까지가 이름이다 — 180mL·750mL 가 같은 이름이면 서로 다른 상품으로 읽히지 않는다.
    name: `${p.name} ${p.volume}`,
    sku: p.id,
    url,
    image: images,
    description: productSeo(p).jsonLdDescription,
    brand: { "@type": "Brand", name: BRAND.name },
    manufacturer: { "@id": ORG_ID },
    category: p.label.type,
    size: p.volume,
    additionalProperty: productProperties(p),
    // 별점은 실제 후기가 있을 때만(count>0) 방출. 없으면 키 자체를 생략한다.
    ...(hasRating
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: opts.rating!.value,
            reviewCount: opts.rating!.count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    offers: {
      "@type": "Offer",
      url,
      // 정가(회원이 아니어도 사는 1회 구매 단가, DB 가격). 정기구독가는 4–24주 선납 구독을 사야 적용되는
      //   가격이라 구글 로열티 회원가(validForMemberTier)에 해당하지 않고 구독가 표기도 없다 → 본문·FAQ 에서 설명.
      price: String(p.price), // schema.org/Google 권장: price는 문자열
      priceCurrency: "KRW",
      availability:
        opts.inStock === false
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@id": ORG_ID },
      ...(opts.priceValidUntil
        ? { priceValidUntil: opts.priceValidUntil }
        : {}),
      shippingDetails: buildShippingDetails(),
      hasMerchantReturnPolicy: buildReturnPolicy(),
    },
  };
}

/** 이동 경로. 첫 항목은 '홈' 대신 브랜드명(네이버 가이드), #조각 주소는 쓰지 않는다. */
export function buildBreadcrumb(items: readonly { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: abs(it.path),
    })),
  };
}

/** 목장 소개 페이지(/story) — 조직을 '소개하는' 페이지임을 밝힌다. */
export function buildAboutPage(page: { name: string; description: string; path: string }) {
  const url = abs(page.path);
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${url}#webpage`,
    url,
    name: page.name,
    description: page.description,
    inLanguage: "ko-KR",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
  };
}

export function buildFAQPage(items: readonly FaqItem[], path?: string) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    ...(path ? { "@id": `${abs(path)}#faq`, url: abs(path) } : {}),
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  };
}
