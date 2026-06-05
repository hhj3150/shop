// 업계 소식 레이더 — 검색 쿼리·RSS 파싱(순수 함수, 테스트 대상).
//   외부 호출(fetch·OpenAI)은 스케줄 함수에서 수행하고, 파싱/URL/프롬프트는 여기서.

export type RadarQuery = { topic: string; q: string };

// 감시 주제(영문 검색어 — 글로벌 뉴스 커버). topic 은 한글 라벨.
export const RADAR_QUERIES: RadarQuery[] = [
  { topic: "A2 우유", q: '"A2 milk" OR "A2 beta-casein"' },
  { topic: "저지 젖소", q: '"Jersey cow" OR "Jersey cattle" milk dairy' },
  { topic: "헤이밀크", q: '"hay milk" OR Heumilch' },
  { topic: "동물복지", q: 'dairy "animal welfare"' },
  { topic: "저탄소 낙농", q: '"low-carbon" dairy OR "regenerative dairy" OR "sustainable dairy"' },
];

// Google News RSS 검색 URL(무료, 키 불필요). 최근 7일 영문 글로벌.
export function googleNewsRssUrl(query: string): string {
  const q = encodeURIComponent(`${query} when:7d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export type RssItem = { title: string; link: string; source: string; pubDate: string };

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
    items.push({ title, link, source: grab("source"), pubDate: grab("pubDate") });
    if (items.length >= max) break;
  }
  return items;
}

// OpenAI 선별·번역 프롬프트(JSON 강제). 후보 중 가장 연관성 높은 1건만 한글로.
export function buildRadarPrompt(candidates: Array<RssItem & { topic: string }>): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.topic}] ${c.title}${c.source ? ` (출처: ${c.source})` : ""}\n   link: ${c.link}\n   date: ${c.pubDate}`
    )
    .join("\n");
  return [
    "다음은 최근 1주간 수집한 뉴스 후보입니다. A2 우유·저지 젖소·헤이밀크·낙농 동물복지·저탄소(지속가능) 낙농 주제와",
    "가장 연관성 높고 신뢰할 만한 '단 1건'을 고르세요. 광고·낚시성·무관 기사는 제외합니다.",
    "고른 1건을 한국어로 자연스럽게 번역·요약해 아래 JSON 형식으로만 답하세요(다른 텍스트 금지).",
    "",
    "후보:",
    list,
    "",
    '형식: {"title_ko":"한글 제목","summary_ko":"2~3문장 한글 요약","source_name":"매체명","source_url":"원문 link","original_title":"원문 제목","topic":"주제 라벨","relevant":true}',
    "적절한 후보가 없으면 {\"relevant\":false} 만 답하세요.",
  ].join("\n");
}
