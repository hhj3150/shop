import { describe, it, expect } from "vitest";
import { parseRss } from "./news-radar";

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
