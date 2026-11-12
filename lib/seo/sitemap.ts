import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PUBLIC_PRODUCTS } from "@/lib/products";
import { PAGE_UPDATED, PRODUCT_UPDATED } from "./lastmod";

// sitemap.xml 항목 — 공개 페이지 + 공개 제품. 비공개(로그인·결제·주문·관리자)와 미공개 제품은 넣지 않는다.
//   lastModified = 실제 내용 변경일(lib/seo/lastmod.ts). 날짜를 모르는 주소는 생략한다(틀린 날짜보다 낫다).
//   이미지: 제품 사진을 함께 알린다(Next 가 <image:image> 로 출력). 이 직렬화기는 XML 이스케이프를
//   하지 않으므로 '&' 가 든 주소를 넣지 않는다(지금 경로들은 모두 안전).

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
  const products = PUBLIC_PRODUCTS.map((p) => {
    const imgs = p.gallery?.length ? p.gallery.map((g) => g.src) : [p.image];
    return {
      url: abs(`/products/${p.id}`),
      ...(PRODUCT_UPDATED[p.id] ? { lastModified: PRODUCT_UPDATED[p.id] } : {}),
      images: imgs.map((src) => `${SITE_URL}${src}`),
    };
  });
  return [...pages, ...products];
}
