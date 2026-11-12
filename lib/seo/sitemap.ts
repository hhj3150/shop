import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PUBLIC_PRODUCTS } from "@/lib/products";
import { PAGE_UPDATED, PRODUCT_UPDATED } from "./lastmod";
import { learnSitemapEntries } from "./learn";

// sitemap.xml 항목 — 공개 페이지 + 공개 제품. 비공개(로그인·결제·주문·관리자)와 미공개 제품은 넣지 않는다.
//   lastModified = 실제 내용 변경일(lib/seo/lastmod.ts). 날짜를 모르는 주소는 생략한다(틀린 날짜보다 낫다).
//   이미지는 넣지 않는다 — Next 직렬화기가 <image:image> 를 <lastmod> 앞에 써서 sitemap XSD 를 어긴다
//   (lastmod 를 읽지 못하는 파서가 생긴다). 제품 사진은 Product 구조화데이터(image)가 알린다.
//   이 직렬화기는 XML 이스케이프를 하지 않으므로 '&' 가 든 주소를 넣지 않는다(지금 경로들은 모두 안전).

export const SITEMAP_PAGES = [
  "/",
  "/faq",
  "/story",
  "/order-once",
  "/signup",
  "/guide",
  "/terms",
  "/privacy",
] as const;

const abs = (p: string) => `${SITE_URL}${p === "/" ? "" : p}`;

export function buildSitemap(): MetadataRoute.Sitemap {
  const pages = SITEMAP_PAGES.map((path) => ({
    url: abs(path),
    ...(PAGE_UPDATED[path] ? { lastModified: PAGE_UPDATED[path] } : {}),
  }));
  const products = PUBLIC_PRODUCTS.map((p) => ({
    url: abs(`/products/${p.id}`),
    ...(PRODUCT_UPDATED[p.id] ? { lastModified: PRODUCT_UPDATED[p.id] } : {}),
  }));
  // 해설 페이지(/learn, /learn/<slug>) — 날짜는 lib/seo/learn.ts 의 updated.
  const learn = learnSitemapEntries().map((e) => ({ url: abs(e.path), lastModified: e.updated }));
  return [...pages, ...products, ...learn];
}
