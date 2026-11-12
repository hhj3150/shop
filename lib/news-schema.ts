import { SITE_URL, BRAND } from "@/lib/site";
import { formatTitle, type NewsRow } from "@/lib/news";
import { ORG_ID, WEBSITE_ID, buildBreadcrumb } from "@/lib/seo/schema";
import { DEFAULT_OG_IMAGE } from "@/lib/seo/meta";
import { newsExcerpt, newsPath, newsUrl, toIsoOrNull } from "@/lib/news-feed";

// 목장 소식 한 건의 구조화데이터(JSON-LD) — 부수효과 없는 순수 함수(lib/seo/schema.ts 와 같은 규칙).
//   ★ 글쓴이·발행처는 조직 노드(#organization — 루트 layout 이 모든 페이지에 낸다)를 '@id' 로 가리킨다.
//     같은 주체임을 그래프로 잇되, @id 를 따라가지 않는 파서를 위해 type·name·url 도 함께 적는다.
//   ★ 화면과 같은 사실만: 제목 = H1, 날짜 = 화면 <time>, 설명 = 본문 앞부분, 이미지 = 화면 표지 사진.
//   ★ 유튜브 영상은 VideoObject 로 적지 않는다 — 필수인 uploadDate(영상 업로드일)를 알 수 없고,
//     글 게시일을 대신 쓰면 틀린 사실이 된다.

const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE_URL}${path}`);

const orgRef = () => ({ "@type": "Organization", "@id": ORG_ID, name: BRAND.name, url: SITE_URL });

/** 구조화데이터 image — http(s) 표지 사진이면 그것, 아니면 기본 공유 이미지(브랜드). */
export function newsSchemaImage(cover: string | null | undefined): string {
  if (cover && /^https:\/\//i.test(cover)) return cover;
  return abs(DEFAULT_OG_IMAGE.url);
}

export type NewsSchemaRow = Pick<NewsRow, "id" | "title" | "body" | "cover_url" | "created_at" | "updated_at">;

export function buildNewsArticle(row: NewsSchemaRow) {
  const url = newsUrl(row.id);
  const published = toIsoOrNull(row.created_at);
  const modified = toIsoOrNull(row.updated_at) ?? published;
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    headline: formatTitle(row.title),
    description: newsExcerpt(row.body),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    isPartOf: { "@id": WEBSITE_ID },
    inLanguage: "ko-KR",
    image: [newsSchemaImage(row.cover_url)],
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    author: orgRef(),
    publisher: orgRef(),
  };
}

/** 이동 경로: 송영신목장 › 목장 이야기 › (글 제목). */
export function buildNewsBreadcrumb(row: Pick<NewsRow, "id" | "title">) {
  return buildBreadcrumb([
    { name: "송영신목장", path: "/" },
    { name: "목장 이야기", path: "/story" },
    { name: formatTitle(row.title), path: newsPath(row.id) },
  ]);
}
