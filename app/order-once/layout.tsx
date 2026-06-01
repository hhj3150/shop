import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "단품 구매",
  description: "회원이 아니어도 구매할 수 있는 A2 저지 헤이밀크·플레인 요거트 단품(1회) 주문.",
  alternates: { canonical: "/order-once" },
};

export default function OrderOnceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
