import { describe, it, expect } from "vitest";
import {
  buildOrganization,
  buildWebSite,
  buildLocalBusiness,
  buildProduct,
  buildFAQPage,
  buildBreadcrumb,
  buildAboutPage,
  buildCertification,
  intlTel,
  ORG_ID,
  WEBSITE_ID,
  STORE_ID,
} from "./schema";
import {
  BUSINESS,
  SITE_URL,
  BRAND,
  BRAND_HOME,
  FARM_HOURS_SPEC,
  CS_HOURS,
  ADDRESS_PARTS,
} from "@/lib/site";
import { PRODUCTS, PUBLIC_PRODUCTS, ONCE_SHIPPING_KRW } from "@/lib/products";
import { CERTIFICATIONS, activeCertifications } from "@/lib/certifications";
import { FAQ_ITEMS } from "./faq";

describe("buildOrganization — 브랜드와 법인을 한 주체로", () => {
  const org = buildOrganization();

  it("name 은 브랜드(송영신목장), legalName 은 사업자 법인명", () => {
    expect(org["@type"]).toBe("Organization");
    expect(org["@id"]).toBe(ORG_ID);
    expect(org.name).toBe(BRAND.name);
    expect(org.legalName).toBe(BUSINESS.company);
    expect(org.url).toBe(SITE_URL);
    expect(org.taxID).toBe(BUSINESS.bizNo);
  });

  it("공식 채널을 sameAs 로 잇는다(브랜드 홈 포함, 영상 단축링크는 제외)", () => {
    expect(org.sameAs).toContain(BRAND_HOME);
    for (const u of org.sameAs) expect(u).not.toMatch(/youtu\.be/);
  });

  it("주소는 사업자 표시 주소를 나눈 값, 우편번호는 추정하지 않는다", () => {
    expect(org.address.addressRegion).toBe(ADDRESS_PARTS.region);
    expect(org.address.addressLocality).toBe(ADDRESS_PARTS.locality);
    expect(org.address.streetAddress).toBe(ADDRESS_PARTS.street);
    expect("postalCode" in org.address).toBe(false);
  });

  it("고객센터 시간은 CS_HOURS(점심 제외 두 구간)", () => {
    const hours = org.contactPoint[0].hoursAvailable;
    expect(hours.map((h) => [h.opens, h.closes])).toEqual(
      CS_HOURS.spec.map((s) => [s.opens, s.closes])
    );
    expect(org.contactPoint[0].telephone).toBe(intlTel(BUSINESS.tel));
  });

  it("인증이 없으면 hasCertification 키를 두지 않고, 주면 그 수만큼 넣는다", () => {
    expect("hasCertification" in org).toBe(false);
    const certs = activeCertifications("2026-11-12");
    const withCerts = buildOrganization({ certifications: certs });
    expect(withCerts.hasCertification).toHaveLength(certs.length);
  });

  it("단순변심 반품 불가 정책을 조직 단위로도 밝힌다", () => {
    expect(org.hasMerchantReturnPolicy.returnPolicyCategory).toBe(
      "https://schema.org/MerchantReturnNotPermitted"
    );
  });
});

describe("buildCertification", () => {
  it("만료일이 있으면 expires, 없으면 키를 두지 않는다", () => {
    const withEnd = CERTIFICATIONS.find((c) => c.validUntil)!;
    const noEnd = CERTIFICATIONS.find((c) => c.validUntil === null)!;
    const a = buildCertification(withEnd);
    expect(a.certificationIdentification).toBe(withEnd.number);
    expect(a.issuedBy.name).toBe(withEnd.issuer);
    expect((a as Record<string, unknown>).expires).toBe(withEnd.validUntil);
    expect("expires" in buildCertification(noEnd)).toBe(false);
  });

  it("만료된 인증은 조직 구조화데이터에 들어가지 않는다(activeCertifications 를 거친다)", () => {
    const expired = CERTIFICATIONS.find((c) => c.validUntil && c.validUntil < "2026-11-12");
    expect(expired, "만료 예시(깨끗한 축산농장 지정)가 데이터에 있어야 이 테스트가 의미 있다").toBeTruthy();
    const org = buildOrganization({ certifications: activeCertifications("2026-11-12") });
    const names = (org.hasCertification ?? []).map((c) => c.name);
    expect(names).not.toContain(expired!.name);
  });
});

describe("buildWebSite", () => {
  it("짧은 브랜드명 + 한국어 + 조직을 발행자로", () => {
    const site = buildWebSite();
    expect(site["@type"]).toBe("WebSite");
    expect(site["@id"]).toBe(WEBSITE_ID);
    expect(site.name).toBe(BRAND.name);
    expect(site.url).toBe(SITE_URL);
    expect(site.inLanguage).toBe("ko-KR");
    expect(site.publisher["@id"]).toBe(ORG_ID);
  });
});

describe("buildLocalBusiness — 목장 판매장", () => {
  const lb = buildLocalBusiness();

  it("schema.org 에 있는 타입(Store)이고, 'Farm' 같은 없는 타입을 쓰지 않는다", () => {
    expect(lb["@type"]).toBe("Store");
    expect(JSON.stringify(lb)).not.toContain('"Farm"');
    expect(lb["@id"]).toBe(STORE_ID);
    expect(lb.parentOrganization["@id"]).toBe(ORG_ID);
  });

  it("영업시간은 판매장 시간(FARM_HOURS_SPEC) — 고객센터 시간이 아니다", () => {
    const spec = lb.openingHoursSpecification[0];
    expect(spec.dayOfWeek).toEqual([...FARM_HOURS_SPEC.days]);
    expect(spec.opens).toBe(FARM_HOURS_SPEC.opens);
    expect(spec.closes).toBe(FARM_HOURS_SPEC.closes);
  });

  it("전화·주소는 SSOT", () => {
    expect(lb.telephone).toBe(intlTel(BUSINESS.tel));
    expect(lb.address["@type"]).toBe("PostalAddress");
    expect(lb.address.addressCountry).toBe("KR");
  });
});

describe("intlTel", () => {
  it("국내 번호를 +82 표기로", () => {
    expect(intlTel("031-674-3150")).toBe("+82-31-674-3150");
    expect(intlTel("010-6642-5042")).toBe("+82-10-6642-5042");
  });
});

describe("buildProduct", () => {
  const p = PRODUCTS[0];

  it("이름에 용량까지 — 같은 라인의 용량별 제품 이름이 서로 다르다", () => {
    const names = PUBLIC_PRODUCTS.map((x) => buildProduct(x).name);
    expect(new Set(names).size).toBe(names.length);
    expect(buildProduct(p).name).toBe(`${p.name} ${p.volume}`);
  });

  it("식별자·주소·절대 이미지 배열·브랜드·제조사", () => {
    const node = buildProduct(p);
    expect(node["@type"]).toBe("Product");
    expect(node["@id"]).toBe(`${SITE_URL}/products/${p.id}#product`);
    expect(node.sku).toBe(p.id);
    expect(node.url).toBe(`${SITE_URL}/products/${p.id}`);
    expect(Array.isArray(node.image)).toBe(true);
    for (const img of node.image) expect(img.startsWith(SITE_URL)).toBe(true);
    expect(node.brand.name).toBe(BRAND.name);
    expect(node.manufacturer["@id"]).toBe(ORG_ID);
  });

  it("설명은 카드 감성 문구가 아니라 라벨 사실", () => {
    const node = buildProduct(p);
    expect(node.description).not.toBe(p.shortDesc);
    expect(node.description).toContain(p.volume);
  });

  it("표시사항(원재료·살균 등)을 additionalProperty 로 — 라벨 값 그대로", () => {
    const node = buildProduct(p);
    const ing = node.additionalProperty.find((x) => x.name === "원재료명 및 함량");
    expect(ing?.value).toBe(p.label.ingredients);
  });

  it("KRW 정가 Offer + 새 상품 + 판매자=조직", () => {
    const node = buildProduct(p);
    expect(node.offers["@type"]).toBe("Offer");
    expect(node.offers.price).toBe(String(p.price));
    expect(node.offers.priceCurrency).toBe("KRW");
    expect(node.offers.itemCondition).toBe("https://schema.org/NewCondition");
    expect(node.offers.seller["@id"]).toBe(ORG_ID);
  });

  it("재고: 기본 InStock, inStock:false 면 OutOfStock", () => {
    expect(buildProduct(p).offers.availability).toBe("https://schema.org/InStock");
    expect(buildProduct(p, { inStock: false }).offers.availability).toBe(
      "https://schema.org/OutOfStock"
    );
  });

  it("rating 미지정이면 aggregateRating 키를 방출하지 않는다", () => {
    const node = buildProduct(p);
    expect("aggregateRating" in node).toBe(false);
  });

  it("count=0 이면 aggregateRating 을 방출하지 않는다", () => {
    const node = buildProduct(p, { rating: { value: 0, count: 0 } });
    expect("aggregateRating" in node).toBe(false);
  });

  it("count>0 이면 AggregateRating 을 올바른 형태로 방출한다(5점 척도 명시)", () => {
    const node = buildProduct(p, { rating: { value: 4.7, count: 12 } });
    const ar = (node as { aggregateRating: Record<string, unknown> }).aggregateRating;
    expect(ar["@type"]).toBe("AggregateRating");
    expect(ar.ratingValue).toBe(4.7);
    expect(ar.reviewCount).toBe(12);
    expect(ar.bestRating).toBe(5);
    expect(ar.worstRating).toBe(1);
  });

  it("offers 에 배송(배송비·소요일)·반품정책을 넣는다", () => {
    const node = buildProduct(p);
    const sd = node.offers.shippingDetails;
    expect(sd["@type"]).toBe("OfferShippingDetails");
    expect(sd.shippingRate.value).toBe(ONCE_SHIPPING_KRW);
    expect(sd.shippingRate.currency).toBe("KRW");
    expect(sd.shippingDestination.addressCountry).toBe("KR");
    // 구글 판매자 정보의 배송 표시 필수 항목.
    expect(sd.deliveryTime.handlingTime.unitCode).toBe("DAY");
    expect(sd.deliveryTime.transitTime.minValue).toBeGreaterThan(0);
    expect(node.offers.hasMerchantReturnPolicy["@type"]).toBe("MerchantReturnPolicy");
    // 신선식품 단순변심 반품 불가(약관 제7조)를 정확히 표기 — 허위 반품정책 금지.
    expect(node.offers.hasMerchantReturnPolicy.returnPolicyCategory).toBe(
      "https://schema.org/MerchantReturnNotPermitted"
    );
  });

  it("priceValidUntil 지정 시 offers 에 반영, 미지정 시 키 생략", () => {
    const withDate = buildProduct(p, { priceValidUntil: "2026-12-31" });
    expect((withDate.offers as Record<string, unknown>).priceValidUntil).toBe("2026-12-31");
    expect("priceValidUntil" in buildProduct(p).offers).toBe(false);
  });
});

describe("buildBreadcrumb", () => {
  it("순번·이름·절대 주소, #조각 주소 없음", () => {
    const b = buildBreadcrumb([
      { name: "송영신목장", path: "/" },
      { name: "A2 저지 헤이밀크 180mL", path: "/products/milk-180" },
    ]);
    expect(b["@type"]).toBe("BreadcrumbList");
    expect(b.itemListElement.map((x) => x.position)).toEqual([1, 2]);
    expect(b.itemListElement[1].item).toBe(`${SITE_URL}/products/milk-180`);
    for (const it of b.itemListElement) expect(it.item).not.toContain("#");
  });
});

describe("buildAboutPage", () => {
  it("조직을 소개하는 페이지로 연결한다", () => {
    const a = buildAboutPage({ name: "목장 이야기", description: "d", path: "/story" });
    expect(a["@type"]).toBe("AboutPage");
    expect(a.url).toBe(`${SITE_URL}/story`);
    expect(a.about["@id"]).toBe(ORG_ID);
    expect(a.isPartOf["@id"]).toBe(WEBSITE_ID);
  });
});

describe("buildFAQPage", () => {
  it("입력 items 수만큼 Question을 만든다", () => {
    const faq = buildFAQPage(FAQ_ITEMS);
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity).toHaveLength(FAQ_ITEMS.length);
    expect(faq.mainEntity[0]["@type"]).toBe("Question");
    expect(faq.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
    expect(faq.mainEntity[0].name).toBe(FAQ_ITEMS[0].question);
  });

  it("경로를 주면 url 을 붙인다", () => {
    const faq = buildFAQPage(FAQ_ITEMS, "/faq") as Record<string, unknown>;
    expect(faq.url).toBe(`${SITE_URL}/faq`);
  });

  it("빈 입력이면 mainEntity가 빈 배열", () => {
    expect(buildFAQPage([]).mainEntity).toEqual([]);
  });
});
