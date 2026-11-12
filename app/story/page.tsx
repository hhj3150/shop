import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { storySeo } from "@/lib/seo/copy";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";
import { Provenance } from "@/components/Provenance";
import { FarmBand } from "@/components/FarmBand";
import { RegenerativeBand } from "@/components/RegenerativeBand";
import { NewsBand } from "@/components/NewsBand";
import { NewsRadarBand } from "@/components/NewsRadarBand";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { buildAboutPage } from "@/lib/seo/schema";

// 목장 이야기 — 홈에서 사는 길 밖으로 옮긴 읽을거리.
//   품종의 희소성 · 재생농업 · 목장 소식 · 세계 낙농 소식. 내용은 홈에 있던 그대로다
//   (지우지 않고 자리를 옮겼다). 홈은 상품과 사는 방법에 집중한다.
const storyCopy = storySeo(activeCertifications(kstYmd(new Date().toISOString())));
export const metadata: Metadata = pageMetadata({ ...storyCopy, path: "/story", rss: true });
// 목장 소식(NewsBand)을 서버에서 읽어 HTML 에 넣는다 — 1시간마다 다시 만든다(소식 고유 페이지·RSS 와 같은 주기).
export const revalidate = 3600;

export default function StoryPage() {
  return (
    <>
      <JsonLd
        data={buildAboutPage({
          name: "송영신목장 이야기",
          description: storyCopy.description,
          path: "/story",
        })}
      />
      <div className="pt-16">
        {/* 첫 화면 캡션이 이 페이지의 제목(h1)이다 — 예전에는 h1 이 없었다. */}
        <FarmBand titleAs="h1" />
      </div>
      <Provenance />
      <RegenerativeBand />
      <NewsBand />
      <NewsRadarBand />
      <Footer />
    </>
  );
}
