import type { Metadata } from "next";
import { FaqSection } from "@/components/FaqSection";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { FAQ_ITEMS, moreFaqItems } from "@/lib/seo/faq";
import { buildFAQPage, buildBreadcrumb } from "@/lib/seo/schema";
import { pageMetadata } from "@/lib/seo/meta";
import { PAGE_SEO } from "@/lib/seo/copy";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";
import { livePublicProducts } from "@/lib/seo/live-catalog";

// 자주 묻는 질문 — 문답 전체를 한 주소에 모은 페이지(GEO).
//   검색·AI 가 '송영신목장 A2 우유는 어디서 사나', '헤이밀크란', '어떤 인증인가' 같은 질문의
//   출처로 가리킬 수 있는 고정 주소가 필요했다(홈의 문답은 상품 목록 아래 묻혀 있다).
//   · FAQPage 구조화데이터는 이 페이지 한 곳에만 둔다(홈과 중복 표시하지 않는다).
//   · 서버 렌더 — JS 를 실행하지 않는 크롤러(네이버 Yeti·AI 봇)도 문답 전문을 읽는다.
//   · 인증은 빌드 시점(KST) 기준 유효한 것만.
export const metadata: Metadata = pageMetadata({ ...PAGE_SEO.faq, path: "/faq" });

// 가격 문답은 DB(product_catalog) 가격 — 1시간마다 다시 만든다(제품 상세와 같은 주기).
export const revalidate = 3600;

export default async function FaqPage() {
  const items = [
    ...FAQ_ITEMS,
    ...moreFaqItems(
      activeCertifications(kstYmd(new Date().toISOString())),
      await livePublicProducts()
    ),
  ];
  return (
    <>
      <JsonLd data={buildFAQPage(items, "/faq")} />
      <JsonLd
        data={buildBreadcrumb([
          { name: "송영신목장", path: "/" },
          { name: "자주 묻는 질문", path: "/faq" },
        ])}
      />
      <div className="pt-16">
        <FaqSection items={items} titleAs="h1" />
      </div>
      <Footer />
    </>
  );
}
