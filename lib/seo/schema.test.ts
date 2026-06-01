import { describe, it, expect } from "vitest";
import {
  buildOrganization,
  buildWebSite,
  buildLocalBusiness,
  buildProduct,
  buildFAQPage,
} from "./schema";
import { BUSINESS, SITE_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/products";
import { FAQ_ITEMS } from "./faq";

describe("buildOrganization", () => {
  it("Organization 타입과 SSOT 기반 필드를 갖는다", () => {
    const org = buildOrganization();
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe(BUSINESS.company);
    expect(org.url).toBe(SITE_URL);
    expect(org.sameAs).toContain("https://www.a2jerseymilk.com");
  });
});

describe("buildWebSite", () => {
  it("WebSite 타입과 한국어 로케일을 갖는다", () => {
    const site = buildWebSite();
    expect(site["@type"]).toBe("WebSite");
    expect(site.url).toBe(SITE_URL);
    expect(site.inLanguage).toBe("ko-KR");
  });
});

describe("buildLocalBusiness", () => {
  it("LocalBusiness/Farm 타입과 SSOT 주소·전화를 갖는다", () => {
    const lb = buildLocalBusiness();
    expect(lb["@type"]).toEqual(["LocalBusiness", "Farm"]);
    expect(lb.telephone).toBe(BUSINESS.tel);
    expect(lb.address["@type"]).toBe("PostalAddress");
    expect(lb.address.streetAddress).toBe(BUSINESS.address);
    expect(lb.address.addressCountry).toBe("KR");
    expect(lb.openingHours).toBeTruthy();
  });
});

describe("buildProduct", () => {
  it("Product 타입 + KRW Offer + shortDesc 설명 + 절대 이미지 URL", () => {
    const p = PRODUCTS[0];
    const node = buildProduct(p);
    expect(node["@type"]).toBe("Product");
    expect(node.name).toBe(p.name);
    expect(node.description).toBe(p.shortDesc);
    expect(node.image).toBe(`${SITE_URL}${p.image}`);
    expect(node.offers["@type"]).toBe("Offer");
    expect(node.offers.price).toBe(String(p.price));
    expect(node.offers.priceCurrency).toBe("KRW");
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

  it("빈 입력이면 mainEntity가 빈 배열", () => {
    expect(buildFAQPage([]).mainEntity).toEqual([]);
  });
});
