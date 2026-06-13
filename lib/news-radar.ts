// 업계 소식 레이더 — 검색 쿼리·RSS 파싱(순수 함수, 테스트 대상).
//   외부 호출(fetch·OpenAI)은 스케줄 함수에서 수행하고, 파싱/URL/프롬프트는 여기서.

export type RssItem = { title: string; link: string; source: string; pubDate: string; contentText: string };

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// RSS XML 에서 <item> 들을 추출. (가벼운 정규식 파서 — Google News RSS 형식 기준)
export function parseRss(xml: string, max = 6): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const b of blocks) {
    const grab = (tag: string): string => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? decodeEntities(m[1]) : "";
    };
    const title = grab("title");
    const link = grab("link");
    if (!title || !link) continue;
    const contentRaw = grab("content:encoded") || grab("description");
    items.push({
      title, link, source: grab("source"), pubDate: grab("pubDate"),
      contentText: contentRaw ? stripHtml(contentRaw) : "",
    });
    if (items.length >= max) break;
  }
  return items;
}
