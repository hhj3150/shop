import { describe, it, expect } from "vitest";
import { SITE_URL } from "@/lib/site";
import { ORG_ID, WEBSITE_ID } from "@/lib/seo/schema";
import { serializeJsonLd } from "@/lib/seo/serialize";
import { buildNewsArticle, buildNewsBreadcrumb, newsSchemaImage, type NewsSchemaRow } from "./news-schema";
import { newsUrl } from "./news-feed";

const ID = "0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b";
const COVER = "https://abc.supabase.co/storage/v1/object/public/news/x.webp";

const row = (over: Partial<NewsSchemaRow> = {}): NewsSchemaRow => ({
  id: ID,
  title: " 첫 풀베기를  마쳤습니다 ",
  body: "올해 첫 풀을 베어 건조장에 넣었습니다.\n\n날씨가 좋아 사흘 만에 말렸습니다.",
  cover_url: COVER,
  created_at: "2026-11-11T15:30:00+00:00",
  updated_at: "2026-11-12T03:00:00.123456+00:00",
  ...over,
});

describe("BlogPosting", () => {
  const a = buildNewsArticle(row());

  it("필수·권장 속성", () => {
    expect(a["@context"]).toBe("https://schema.org");
    expect(a["@type"]).toBe("BlogPosting");
    expect(a["@id"]).toBe(`${newsUrl(ID)}#article`);
    expect(a.headline).toBe("첫 풀베기를 마쳤습니다");
    expect(a.url).toBe(newsUrl(ID));
    expect(a.mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": newsUrl(ID) });
    expect(a.inLanguage).toBe("ko-KR");
    expect(a.isPartOf).toEqual({ "@id": WEBSITE_ID });
    expect(a.datePublished).toBe("2026-11-11T15:30:00.000Z");
    expect(a.dateModified).toBe("2026-11-12T03:00:00.123Z");
    expect(a.description).toBe("올해 첫 풀을 베어 건조장에 넣었습니다. 날씨가 좋아 사흘 만에 말렸습니다.");
  });

  it("글쓴이·발행처는 조직 노드(#organization)를 가리킨다", () => {
    for (const who of [a.author, a.publisher]) {
      expect(who["@id"]).toBe(ORG_ID);
      expect(who["@type"]).toBe("Organization");
      expect(who.name).toBe("송영신목장");
      expect(who.url).toBe(SITE_URL);
    }
  });

  it("이미지: 표지(https)면 그것, 없으면 기본 공유 이미지(절대주소)", () => {
    expect(a.image).toEqual([COVER]);
    expect(buildNewsArticle(row({ cover_url: null })).image).toEqual([`${SITE_URL}/brand/og-default.jpg`]);
    expect(newsSchemaImage("http://insecure.example/x.jpg")).toBe(`${SITE_URL}/brand/og-default.jpg`);
    expect(newsSchemaImage("javascript:alert(1)")).toBe(`${SITE_URL}/brand/og-default.jpg`);
  });

  it("날짜가 잘못되면 키를 빼고, 수정일이 없으면 게시일", () => {
    const b = buildNewsArticle(row({ created_at: "x", updated_at: "y" }));
    expect("datePublished" in b).toBe(false);
    expect("dateModified" in b).toBe(false);
    const c = buildNewsArticle(row({ updated_at: "" }));
    expect(c.dateModified).toBe(c.datePublished);
  });

  it("DB 문자열에 </script> 가 있어도 직렬화 결과가 스크립트를 닫지 못한다", () => {
    const s = serializeJsonLd(buildNewsArticle(row({ title: "</script><script>alert(1)</script>" })));
    expect(s).not.toContain("</script>");
    expect(JSON.parse(s).headline).toBe("</script><script>alert(1)</script>");
  });
});

describe("이동 경로", () => {
  it("송영신목장 › 목장 이야기 › 글 제목(절대주소)", () => {
    const b = buildNewsBreadcrumb(row());
    expect(b["@type"]).toBe("BreadcrumbList");
    expect(b.itemListElement.map((i) => [i.position, i.name, i.item])).toEqual([
      [1, "송영신목장", `${SITE_URL}/`],
      [2, "목장 이야기", `${SITE_URL}/story`],
      [3, "첫 풀베기를 마쳤습니다", newsUrl(ID)],
    ]);
  });
});
