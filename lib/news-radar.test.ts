import { describe, it, expect } from "vitest";
import { googleNewsRssUrl, parseRss, buildRadarPrompt, RADAR_QUERIES } from "./news-radar";

describe("googleNewsRssUrl", () => {
  it("쿼리를 인코딩하고 7일 범위를 붙인다", () => {
    const url = googleNewsRssUrl('"A2 milk"');
    expect(url).toContain("news.google.com/rss/search");
    expect(url).toContain("when%3A7d");
    expect(url).toContain("A2");
  });
});

describe("parseRss", () => {
  const xml = `<rss><channel>
    <item>
      <title>A2 milk demand rises - DairyNews</title>
      <link>https://news.google.com/articles/aaa</link>
      <pubDate>Mon, 09 Jun 2026 10:00:00 GMT</pubDate>
      <source url="https://dairynews.com">DairyNews</source>
    </item>
    <item>
      <title><![CDATA[Jersey cattle & welfare]]></title>
      <link>https://news.google.com/articles/bbb</link>
      <pubDate>Tue, 10 Jun 2026 08:00:00 GMT</pubDate>
      <source url="https://x.com">X</source>
    </item>
  </channel></rss>`;

  it("item 들을 제목·링크·출처·날짜로 파싱", () => {
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("A2 milk demand rises - DairyNews");
    expect(items[0].link).toBe("https://news.google.com/articles/aaa");
    expect(items[0].source).toBe("DairyNews");
    expect(items[1].title).toBe("Jersey cattle & welfare"); // CDATA·엔티티 처리
  });

  it("max 로 개수를 제한한다", () => {
    expect(parseRss(xml, 1)).toHaveLength(1);
  });

  it("title/link 없는 블록은 건너뛴다", () => {
    expect(parseRss("<rss></rss>")).toEqual([]);
  });
});

describe("buildRadarPrompt", () => {
  it("후보 목록과 JSON 형식 지시를 포함한다", () => {
    const p = buildRadarPrompt([
      { topic: "A2 우유", title: "A2 news", link: "http://a", source: "S", pubDate: "d" },
    ]);
    expect(p).toContain("A2 news");
    expect(p).toContain("title_ko");
    expect(p).toContain("relevant");
  });
});

describe("RADAR_QUERIES", () => {
  it("핵심 5개 주제를 감시한다", () => {
    const topics = RADAR_QUERIES.map((q) => q.topic);
    expect(topics).toContain("A2 우유");
    expect(topics).toContain("헤이밀크");
    expect(topics).toContain("동물복지");
    expect(topics).toContain("저탄소 낙농");
  });
});
