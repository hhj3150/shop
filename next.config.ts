import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

// 경로에 한글(NFD)이 포함되면 Turbopack의 asset ident 생성이 패닉하므로 webpack을 사용한다.
// (dev/build 스크립트에 --webpack 지정)
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

// Sentry 빌드 래퍼: 소스맵 업로드 + 서버 인스트루멘테이션 주입.
// SENTRY_AUTH_TOKEN 미설정 시 소스맵 업로드만 생략되고 빌드는 정상 진행(라이브 무중단).
//   조직/프로젝트 슬러그는 빌드타임 값(비밀 아님). 인증 토큰만 Netlify 환경변수로 주입.
export default withSentryConfig(nextConfig, {
  org: "d2o-7i",
  project: "a2jersey-shop",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // CI(소스맵 업로드)에서만 로그 출력, 그 외에는 조용히.
  silent: !process.env.CI,
  // 클라이언트 번들에서 Sentry 로거 구문을 트리셰이킹해 용량 절감.
  webpack: { treeshake: { removeDebugLogging: true } },
});

