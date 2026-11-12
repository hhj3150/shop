import { buildLlmsTxt } from "@/lib/seo/llms";
import { llmsInputNow } from "@/lib/seo/llms-input";

// /llms.txt — SSOT 에서 생성(lib/seo/llms.ts). 하루 한 번 다시 만든다(인증 만료·가격 변경 반영).
//   ★ public/llms.txt 를 다시 만들지 않는다 — public 파일이 이 라우트보다 먼저 서빙돼 조용히 가린다.
export const revalidate = 86400;

export async function GET() {
  return new Response(buildLlmsTxt(await llmsInputNow()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
