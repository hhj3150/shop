import { SITE_URL } from "@/lib/site";
import { ORG_ID, WEBSITE_ID } from "./schema";
import { DEFAULT_OG_IMAGE } from "./meta";
import { LEARN_HUB, learnPath, type LearnPage } from "./learn";
import { LEARN_HUB_IMAGE, learnImage } from "./learn-images";

// /learn 해설 페이지의 구조화데이터(JSON-LD) — 부수효과 없는 순수 함수.
//   ★ 저자·발행자는 사이트 공통 조직 노드(#organization, 루트 레이아웃이 모든 페이지에 낸다)를
//     '@id' 로 가리킨다. 이름을 다시 적지 않는다 — 같은 주체가 두 개로 읽히지 않게.
//   ★ 화면과 같은 사실만: 제목·설명·날짜·출처는 lib/seo/learn.ts 의 같은 값을 쓴다.
//     출처 목록은 citation 으로 함께 낸다(AI 답변이 근거를 따라갈 수 있게).
//   이동 경로는 lib/seo/schema.ts 의 buildBreadcrumb 를 그대로 쓴다.

const abs = (path: string) => `${SITE_URL}${path}`;

/** 해설 글 1편 → schema.org Article */
export function buildLearnArticle(page: LearnPage) {
  const url = abs(learnPath(page.slug));
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    headline: page.title,
    description: page.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@id": WEBSITE_ID },
    inLanguage: "ko-KR",
    datePublished: page.published,
    dateModified: page.updated,
    author: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    // 글의 첫 사진(목장 실제 사진)이 있으면 그것, 없으면 사이트 기본 공유 이미지.
    image: abs(learnImage(page.slug)?.src ?? DEFAULT_OG_IMAGE.url),
    about: page.about.map((name) => ({ "@type": "Thing", name })),
    citation: page.sources.map((s) => ({
      "@type": "CreativeWork",
      name: s.name,
      url: s.url,
      // 발행일이 없는 공식 페이지(열람 연도만 아는 곳)에는 발행일을 지어내지 않는다.
      ...(s.accessed ? {} : { datePublished: String(s.year) }),
    })),
  };
}

/** /learn 허브 → CollectionPage + 글 목록(ItemList) */
export function buildLearnHub(pages: readonly LearnPage[]) {
  const url = abs(LEARN_HUB.path);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: LEARN_HUB.title,
    description: LEARN_HUB.description,
    inLanguage: "ko-KR",
    isPartOf: { "@id": WEBSITE_ID },
    publisher: { "@id": ORG_ID },
    dateModified: LEARN_HUB.updated,
    image: abs(LEARN_HUB_IMAGE.src),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: pages.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: abs(learnPath(p.slug)),
        name: p.title,
      })),
    },
  };
}
