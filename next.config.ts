import type { NextConfig } from "next";
import path from "node:path";

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

export default nextConfig;
