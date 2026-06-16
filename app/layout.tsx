import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR, Noto_Serif_KR, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { CartProvider } from "@/lib/cart";
import { AuthProvider } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { BottomNav } from "@/components/BottomNav";
import { CartDrawer } from "@/components/CartDrawer";
import { CustomerAssistant } from "@/components/CustomerAssistant";
import { Track } from "@/components/Track";
import { ReferralCapture } from "@/components/ReferralCapture";
import { JsonLd } from "@/components/JsonLd";
import { buildOrganization, buildWebSite } from "@/lib/seo/schema";

// 폰트 weight는 실제 사용분만 로드한다(한글 폰트는 weight마다 대용량).
// 앱 전역 사용: 400(normal)·500(medium)·600(semibold) + <strong>/<b>용 700(sans만).
// 미사용 300(font-light)·serif/cormorant 700·cormorant 600은 제외 — 불필요한 다운로드 절감.
const notoSans = Noto_Sans_KR({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  // 한글 본문 폰트는 latin 서브셋 preload가 무용하고 LCP 이미지와 대역폭을
  // 경쟁한다. preload 해제 → LCP 우선, display:swap이 폴백으로 첫 페인트 보장.
  preload: false,
});

const notoSerif = Noto_Serif_KR({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "송영신목장 · A2 Jersey Hay Milk",
    template: "%s · 송영신목장",
  },
  description:
    "대한민국 0.01%의 희소한 A2/A2 저지소, 사일리지 없이 건초만 먹은 헤이밀크. 송영신목장이 직접 짓고, 직접 발효하고, 직접 보냅니다.",
  openGraph: {
    title: "송영신목장 · A2 Jersey Hay Milk",
    description: "한 잔의 정직함. 경기도 안성, 송영신목장의 A2 저지 헤이밀크와 플레인 요거트.",
    type: "website",
    locale: "ko_KR",
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "송영신목장 · A2 Jersey Hay Milk",
    description: "한 잔의 정직함. 경기도 안성, 송영신목장의 A2 저지 헤이밀크와 플레인 요거트.",
    images: ["/brand/og-default.jpg"],
  },
};

// viewport-fit=cover라야 env(safe-area-inset-*)가 노치/홈바 영역으로 채워진다.
// 이게 없으면 BottomNav의 safe-area 패딩이 0으로 죽어 홈 인디케이터에 가린다.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf6ee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSans.variable} ${notoSerif.variable} ${cormorant.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink-soft">
        <AuthProvider>
          <JsonLd data={buildOrganization()} />
          <JsonLd data={buildWebSite()} />
          <CartProvider>
            <Nav />
            <main className="flex-1 pb-[68px] md:pb-0">{children}</main>
            <BottomNav />
            <CartDrawer />
            <CustomerAssistant />
            <Track event="visit" once />
            <ReferralCapture />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
