import { describe, it, expect } from "vitest";
import { googleNewsRssUrl, parseRss, buildRadarPrompt, RADAR_QUERIES } from "./news-radar";

describe("googleNewsRssUrl", () => {
  it("쿼리를 인코딩하고 7일 범위를 붙인다", () => {
    const url = googleNewsRssUrl('"A2 milk"');
    expect(url).toContain("news.google.com/rss/search");
    expect(url).toContain("when%3A7d");
    expect(url).toContain("A2");
  });

  it("기간 인자를 주면 when:Nd 로 반영한다", () => {
    expect(googleNewsRssUrl('"A2 milk"', 30)).toContain("when%3A30d");
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
      { topic: "A2 우유", title: "A2 news", link: "http://a", source: "S", pubDate: "d", contentText: "" },
    ]);
    expect(p).toContain("A2 news");
    expect(p).toContain("title_ko");
    expect(p).toContain("relevant");
  });
});

describe("RADAR_QUERIES", () => {
  it("핵심 낙농 주제를 감시한다", () => {
    const topics = RADAR_QUERIES.map((q) => q.topic);
    expect(topics).toContain("A2 우유");
    expect(topics).toContain("헤이밀크");
    expect(topics).toContain("동물복지");
    expect(topics).toContain("저탄소 낙농");
  });

  it("유제품·건강 및 미국 식단 가이드 주제를 포함한다", () => {
    const topics = RADAR_QUERIES.map((q) => q.topic);
    expect(topics).toContain("우유와 건강");
    expect(topics).toContain("요거트·장건강");
    expect(topics).toContain("유제품 영양");
    expect(topics).toContain("미국 식단 가이드");
  });

  it("모든 검색어는 비어 있지 않다", () => {
    for (const { topic, q } of RADAR_QUERIES) {
      expect(topic.trim().length).toBeGreaterThan(0);
      expect(q.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("parseRss contentText", () => {
  it("description 을 contentText 로 추출(HTML/엔티티 제거)", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link>
      <description><![CDATA[<p>Heat &amp; cows <b>rise</b></p>]]></description></item></channel></rss>`;
    expect(parseRss(xml)[0].contentText).toBe("Heat & cows rise");
  });
  it("content:encoded 가 있으면 우선", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link>
      <description>short</description>
      <content:encoded><![CDATA[<p>Full body text</p>]]></content:encoded></item></channel></rss>`;
    expect(parseRss(xml)[0].contentText).toBe("Full body text");
  });
  it("본문 없으면 빈문자", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link></item></channel></rss>`;
    expect(parseRss(xml)[0].contentText).toBe("");
  });
});
