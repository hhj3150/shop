import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PRIVATE = [
  "/admin",
  "/account",
  "/checkout",
  "/api",
  "/login",
  "/forgot-password",
  "/reset-password",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // AI 크롤러 명시 환영(전체 허용과 동일하나 의도를 분명히).
      { userAgent: "GPTBot", allow: "/", disallow: PRIVATE },
      { userAgent: "ClaudeBot", allow: "/", disallow: PRIVATE },
      { userAgent: "PerplexityBot", allow: "/", disallow: PRIVATE },
      { userAgent: "Google-Extended", allow: "/", disallow: PRIVATE },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
