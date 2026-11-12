import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/seo/sitemap";
import { listNewsForSitemap } from "@/lib/news-server";

// 항목·수정일은 lib/seo/sitemap.ts · lib/seo/lastmod.ts · lib/seo/learn.ts 가 단일 출처.
// 목장 소식(/story/news/<id>)은 DB 에서 읽으므로 1시간마다 다시 만든다(새 글이 재배포 없이 들어오게).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const news = (await listNewsForSitemap()).map((e) => ({ url: e.url, lastModified: e.lastModified }));
  return [...buildSitemap(), ...news];
}
