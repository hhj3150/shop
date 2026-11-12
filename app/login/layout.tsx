import type { Metadata } from "next";
import { privateMetadata } from "@/lib/seo/meta";

// 검색 색인 제외(noindex) — 손님 개인 화면이라 검색 결과·AI 답변에 나올 이유가 없다.
//   page 가 "use client" 라 metadata 를 거기서 내보낼 수 없어 서버 layout 에서 지정한다.
//   ★ robots.txt 로 막지 않는다 — 막으면 크롤러가 이 noindex 를 읽지 못해 주소만 색인될 수 있다.
export const metadata: Metadata = privateMetadata("로그인");

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
