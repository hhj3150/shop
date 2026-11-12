import { SITE_URL } from "@/lib/site";
import { buildRobotsTxt, daumVerificationLine } from "@/lib/seo/robots";

// /robots.txt — 빌드 때 한 번 만든다. 다음 웹마스터도구 인증줄은 환경변수
//   DAUM_WEBMASTER_VERIFICATION('hash:code')가 있을 때만 붙는다(lib/seo/robots.ts).
export const dynamic = "force-static";

export function GET() {
  const daum = process.env.DAUM_WEBMASTER_VERIFICATION;
  if (daum?.trim() && !daumVerificationLine(daum)) {
    // 값이 있는데 형식이 맞지 않으면 인증줄이 빠진다 — 조용히 실패하지 않게 빌드 로그에 남긴다.
    console.warn("[robots.txt] DAUM_WEBMASTER_VERIFICATION 형식이 'hash:code' 가 아니라 인증줄을 넣지 않았습니다.");
  }
  return new Response(
    buildRobotsTxt({
      siteUrl: SITE_URL,
      daumVerification: daum,
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
