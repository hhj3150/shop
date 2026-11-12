import { buildLlmsFullTxt } from "@/lib/seo/llms";
import { llmsInputNow } from "@/lib/seo/llms-input";

// /llms-full.txt — llms.txt + 제품 표시사항·영양정보 + 전체 문답. 하루 한 번 다시 만든다.
export const revalidate = 86400;

export async function GET() {
  return new Response(buildLlmsFullTxt(await llmsInputNow()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
