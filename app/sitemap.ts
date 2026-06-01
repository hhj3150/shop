import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { PRODUCTS } from "@/lib/products";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = ["", "/order-once", "/signup", "/guide", "/terms", "/privacy"];
  const productPaths = PRODUCTS.map((p) => `/products/${p.id}`);
  return [...staticPaths, ...productPaths].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
  }));
}
