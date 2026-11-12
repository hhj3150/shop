import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";
import type { LlmsInput } from "./llms";
import { livePublicProducts } from "./live-catalog";
import { fetchPublishedNews } from "@/lib/news-server";

// llms 라우트의 입력 — '오늘' 과 환경변수는 여기서만 읽는다(빌더는 순수 함수로 둔다).
//   카드·간편결제는 lib/portone.ts 의 isPortOneConfigured 와 같은 조건(두 환경변수가 모두 있을 때).
//   portone.ts 는 브라우저 SDK 를 불러오므로 서버 라우트에서 import 하지 않고 조건만 같게 둔다.
//   제품 가격은 DB(product_catalog) 값 — 조회 실패 시 정적 값(live-catalog 폴백).
export async function llmsInputNow(): Promise<LlmsInput> {
  return {
    products: await livePublicProducts(),
    news: await fetchPublishedNews(),
    certifications: activeCertifications(kstYmd(new Date().toISOString())),
    cardPayment: Boolean(
      process.env.NEXT_PUBLIC_PORTONE_STORE_ID && process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY
    ),
  };
}
