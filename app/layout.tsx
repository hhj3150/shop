import type { Metadata, Viewport } from "next";
import { preload } from "react-dom";
import "./fonts.css";
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
import {
  SITE_NAME,
  TITLE_SUFFIX,
  OG_LOCALE,
  DEFAULT_OG_IMAGE,
  searchVerification,
} from "@/lib/seo/meta";
import { SITE_TITLE_DEFAULT, SITE_DESCRIPTION } from "@/lib/seo/copy";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";

// 웹폰트는 사이트 안에 둔다(app/fonts.css + public/fonts) — 빌드 때 구글 폰트에 묻지 않는다.
//   예전 next/font/google 설정을 그대로 옮겼다: 한글 두 서체는 가변 글꼴(굵기 전 구간 한 파일 × 유니코드 조각),
//   preload 없음(LCP 이미지와 대역폭 경쟁 방지 — 2026 Lighthouse 실측), 제목용 Cormorant 라틴 조각 2개만 preload.
const PRELOAD_FONTS = ["/fonts/7b89a4fd5e90ede0-s.p.woff2", "/fonts/e18f83c737786aa7-s.p.woff2"];

// 루트 메타데이터 — 개별 문구가 없는 페이지의 기본값.
//   ★ openGraph·twitter 에 title/description 을 넣지 않는다. 넣으면 개별 openGraph 가 없는 페이지까지
//     홈 문구로 공유 카드가 나간다(예전 /story·/guide 등). 비워 두면 각 페이지의 <title>·설명이
//     자동으로 들어간다. 공개 페이지는 lib/seo/meta.ts 의 pageMetadata 로 전부를 직접 받는다.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE_DEFAULT,
    template: `%s${TITLE_SUFFIX}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: OG_LOCALE,
    siteName: SITE_NAME,
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: { card: "summary_large_image" },
  // robots(index·큰 이미지 미리보기)는 공개 페이지가 pageMetadata 로 직접 받는다(lib/seo/meta.ts).
  //   루트에 두면 404 화면에 Next 기본 noindex 와 'index' 가 함께 나간다.
  // 검색엔진 소유확인 — 값은 Netlify 환경변수(GOOGLE_/NAVER_/BING_SITE_VERIFICATION)로 넣는다.
  verification: searchVerification(process.env),
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
  for (const href of PRELOAD_FONTS) preload(href, { as: "font", type: "font/woff2", crossOrigin: "" });
  return (
    <html
      lang="ko"
      className="h-full"
    >
      <body className="min-h-full flex flex-col bg-paper text-ink-soft">
        <AuthProvider>
          {/* 인증은 빌드 시점(KST) 기준 유효한 것만 — 배포마다 다시 계산된다. */}
          <JsonLd
            data={buildOrganization({
              certifications: activeCertifications(kstYmd(new Date().toISOString())),
            })}
          />
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
