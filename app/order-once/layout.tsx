import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";

export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.orderOnce, path: "/order-once" });

export default function OrderOnceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
