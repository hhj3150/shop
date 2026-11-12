import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo/sitemap";

// 항목·수정일·이미지는 lib/seo/sitemap.ts · lib/seo/lastmod.ts 가 단일 출처.
export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap();
}
