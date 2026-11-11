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

// ★ 한글 두 서체는 '가변 글꼴(variable)' 하나로 받는다 — weight 를 나열하지 않는다.
//   한글 웹폰트는 글자 수가 많아 구글이 약 120조각으로 쪼개 주는데, 굵기를 따로 나열하면
//   조각 × 굵기만큼 @font-face 가 생긴다. 예전 설정(본문 4굵기·명조 3굵기)은 @font-face 가
//   870개, 화면을 막는(render-blocking) CSS 가 540KB(전송 173KB)였고, 느린 모바일에서
//   첫 주요 화면(LCP)이 홈 9.4초까지 밀렸다(Lighthouse 실측).
//   가변 글꼴은 굵기 전 구간이 한 파일이라 @font-face 가 조각 수만큼만 생긴다.
//   400·500·600·700 은 그대로 다 쓸 수 있다.
const notoSans = Noto_Sans_KR({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  display: "swap",
  // 한글 본문 폰트는 latin 서브셋 preload가 무용하고 LCP 이미지와 대역폭을
  // 경쟁한다. preload 해제 → LCP 우선, display:swap이 폴백으로 첫 페인트 보장.
  preload: false,
});

const notoSerif = Noto_Serif_KR({
  variable: "--font-noto-serif",
  subsets: ["latin"],
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
    "국내 유일의 A2 저지 단일 품종 목장, 사일리지 없이 건초만 먹은 헤이밀크. 송영신목장이 직접 짓고, 직접 발효하고, 직접 보냅니다.",
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
