import type { Metadata } from "next";
import { privateMetadata } from "@/lib/seo/meta";

// 관리자 화면 — 검색 색인 제외(noindex). robots.txt 에서도 /admin 은 수집 자체를 막는다(이중 차단).
//   page 가 "use client" 라 metadata 를 거기서 내보낼 수 없어 서버 layout 에서 지정한다.
export const metadata: Metadata = privateMetadata("관리자");

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
