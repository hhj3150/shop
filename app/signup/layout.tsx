import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "정기구독 신청",
  description: "선착순 500인 한정 A2 저지 헤이밀크 회원제 정기구독을 신청하세요.",
  alternates: { canonical: "/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
