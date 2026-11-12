import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";

export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.signup, path: "/signup" });

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
