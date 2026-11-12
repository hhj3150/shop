import { SITE_URL } from "@/lib/site";
import { buildRobotsTxt } from "@/lib/seo/robots";

// /robots.txt — 빌드 때 한 번 만든다. 다음 웹마스터도구 인증줄은 환경변수
//   DAUM_WEBMASTER_VERIFICATION('hash:code')가 있을 때만 붙는다(lib/seo/robots.ts).
export const dynamic = "force-static";

export function GET() {
  return new Response(
    buildRobotsTxt({
      siteUrl: SITE_URL,
      daumVerification: process.env.DAUM_WEBMASTER_VERIFICATION,
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
