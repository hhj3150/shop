import { fetchPublishedNews } from "@/lib/news-server";
import { buildNewsRss } from "@/lib/news-feed";

// /rss.xml — 목장 소식 RSS 2.0(네이버 서치어드바이저 'RSS 제출'용). 본문 전체를 담는다(lib/news-feed.ts).
//   1시간마다 다시 만든다(소식 고유 페이지와 같은 주기). 글이 없으면 item 0개인 올바른 피드를 낸다 —
//   네이버는 item 이 1개 이상이어야 제출을 받으므로 첫 소식을 게시한 뒤 제출한다.
export const revalidate = 3600;

export async function GET() {
  return new Response(buildNewsRss(await fetchPublishedNews()), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
