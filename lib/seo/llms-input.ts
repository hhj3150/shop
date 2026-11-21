import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";
import type { LlmsInput } from "./llms";
import { livePublicProducts } from "./live-catalog";
import { fetchPublishedNews } from "@/lib/news-server";

// llms 라우트의 입력 — '오늘' 과 환경변수는 여기서만 읽는다(빌더는 순수 함수로 둔다).
//   카드·간편결제는 나이스페이 결제창이 뜨는 조건(lib/nicepay/server.ts nicepayConfig)과 같게 둔다 —
//   스위치(NICEPAY_ENABLED=true)가 켜지고 키 세 개가 모두 있을 때만 '카드결제 가능'으로 안내한다.
//   제품 가격은 DB(product_catalog) 값 — 조회 실패 시 정적 값(live-catalog 폴백).
export async function llmsInputNow(): Promise<LlmsInput> {
  return {
    products: await livePublicProducts(),
    news: await fetchPublishedNews(),
    certifications: activeCertifications(kstYmd(new Date().toISOString())),
    cardPayment: Boolean(
      (process.env.NICEPAY_ENABLED ?? "").trim().toLowerCase() === "true" &&
        process.env.NICEPAY_CLIENT_ID &&
        process.env.NICEPAY_SECRET_KEY &&
        process.env.NICEPAY_API_BASE
    ),
  };
}
