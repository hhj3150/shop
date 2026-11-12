import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildSitemap, SITEMAP_PAGES } from "./sitemap";
import { PAGE_UPDATED, PRODUCT_UPDATED, LEGAL_UPDATED } from "./lastmod";
import { PUBLIC_PRODUCTS, PRODUCTS } from "@/lib/products";
import { SITE_URL } from "@/lib/site";

const root = join(__dirname, "..", "..");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

describe("sitemap.xml", () => {
  const sm = buildSitemap();
  const urls = sm.map((e) => e.url);

  it("모든 공개 페이지·공개 제품이 있고, 미공개 제품은 없다", () => {
    for (const p of PUBLIC_PRODUCTS) expect(urls).toContain(`${SITE_URL}/products/${p.id}`);
    for (const p of PRODUCTS.filter((x) => x.unpublished)) {
      expect(urls).not.toContain(`${SITE_URL}/products/${p.id}`);
    }
  });

  it("비공개 경로는 넣지 않는다", () => {
    for (const u of urls) expect(u).not.toMatch(/\/(admin|account|checkout|login|orders|api)\b/);
  });

  it("사이트맵의 고정 페이지는 실제로 존재한다(app/<경로>/page.tsx)", () => {
    for (const path of SITEMAP_PAGES) {
      const file = path === "/" ? "app/page.tsx" : `app${path}/page.tsx`;
      expect(existsSync(join(root, file)), file).toBe(true);
    }
  });

  it("모든 항목에 실제 수정일(YYYY-MM-DD)이 있다 — 빌드 시각을 찍지 않는다", () => {
    for (const e of sm) {
      expect(typeof e.lastModified, e.url).toBe("string");
      expect(e.lastModified as string, e.url).toMatch(YMD);
    }
  });

  it("제품 항목에 절대 주소 이미지를 단다", () => {
    for (const e of sm.filter((x) => x.url.includes("/products/"))) {
      expect(e.images?.length, e.url).toBeGreaterThan(0);
      for (const i of e.images ?? []) expect(i.startsWith(SITE_URL)).toBe(true);
    }
  });

  it("주소에 XML 특수문자(&·<·>)가 없다 — Next 직렬화기가 이스케이프하지 않는다", () => {
    for (const e of sm) for (const s of [e.url, ...(e.images ?? [])]) expect(s).not.toMatch(/[&<>"]/);
  });
});

describe("lastmod 표 — 빠진 날짜가 없다", () => {
  it("모든 제품(미공개 포함)에 날짜가 있다", () => {
    for (const p of PRODUCTS) expect(PRODUCT_UPDATED[p.id], p.id).toMatch(YMD);
  });
  it("약관류 날짜는 화면 '시행일'과 같은 상수", () => {
    expect(PAGE_UPDATED["/guide"]).toBe(LEGAL_UPDATED.guide);
    expect(PAGE_UPDATED["/terms"]).toBe(LEGAL_UPDATED.terms);
    expect(PAGE_UPDATED["/privacy"]).toBe(LEGAL_UPDATED.privacy);
  });
});
