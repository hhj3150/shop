// IndexNow — 페이지가 바뀌었음을 검색엔진에 바로 알린다. 한 번 보내면 참여 엔진(Bing·네이버·Yandex·
//   Seznam·Yep 등)이 함께 받는다. Bing 색인은 ChatGPT 검색·Copilot 답변의 바탕이고, 네이버도 공식 지원한다.
//   구글은 참여하지 않는다(구글은 sitemap.xml 로 알린다).
//
//   키: public/<키>.txt 에 같은 값이 들어 있어야 소유가 확인된다. 키는 공개 파일이 원래 규칙이다(비밀 아님).
//     키를 바꾸면 public 파일 이름·내용과 아래 상수를 함께 바꾼다(lib/seo/indexnow.test.ts 가 확인).
//   보낼 주소: sitemap.xml 의 lastmod 가 최근인 주소만(바뀌지 않은 주소를 반복해 보내지 않는다 — 엔진 권고).
//   보내는 곳: netlify/functions/indexnow.mts(매일 예약 실행), 수동: node scripts/indexnow.mjs

export const INDEXNOW_KEY = "4a1ab90401cb2cd4e6e5bbda25e68d2e";

/** IndexNow 공용 엔드포인트 + 네이버 엔드포인트(네이버 서치어드바이저 가이드). */
export const INDEXNOW_ENDPOINTS = [
  "https://api.indexnow.org/indexnow",
  "https://searchadvisor.naver.com/indexnow",
] as const;

export type SitemapEntry = { loc: string; lastmod?: string };

/** Next 가 만든 sitemap.xml 에서 <loc>·<lastmod> 를 뽑는다(이미지 <image:loc> 은 제외). */
export function parseSitemap(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = m[1].replace(/<image:image>[\s\S]*?<\/image:image>/g, "");
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1]?.trim();
    out.push(lastmod ? { loc, lastmod } : { loc });
  }
  return out;
}

/** lastmod 가 sinceYmd(포함) 이후인 주소. lastmod 가 없는 주소는 고르지 않는다. */
export function recentUrls(entries: readonly SitemapEntry[], sinceYmd: string): string[] {
  return entries.filter((e) => e.lastmod && e.lastmod.slice(0, 10) >= sinceYmd).map((e) => e.loc);
}

/** IndexNow POST 본문. 같은 호스트의 주소만, 최대 10,000개(규격). */
export function indexNowPayload(siteUrl: string, urls: readonly string[]) {
  const host = new URL(siteUrl).host;
  const urlList = [...new Set(urls)].filter((u) => new URL(u).host === host).slice(0, 10000);
  return {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${siteUrl}/${INDEXNOW_KEY}.txt`,
    urlList,
  };
}
