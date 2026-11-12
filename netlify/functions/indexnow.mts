import type { Config } from "@netlify/functions";
import { SITE_URL } from "../../lib/site";
import {
  INDEXNOW_ENDPOINTS,
  parseSitemap,
  recentUrls,
  indexNowPayload,
} from "../../lib/seo/indexnow";

// 매일: 운영 sitemap.xml 에서 '최근 2일 안에 내용이 바뀐' 주소만 골라 IndexNow 로 알린다.
//   수정일은 lib/seo/lastmod.ts 가 단일 출처 — 페이지를 고치고 그 날짜를 바꾸면 다음 날 아침에 알림이 간다.
//   바뀐 주소가 없으면 아무것도 보내지 않는다(같은 주소 반복 제출은 엔진 권고 위반).
//   예약 함수는 배포된 운영 사이트에서만 돈다(Netlify). 수동 전체 제출: node scripts/indexnow.mjs --all
const LOOKBACK_DAYS = 2;

function kstDaysAgo(days: number): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async function handler(): Promise<Response> {
  const since = kstDaysAgo(LOOKBACK_DAYS);
  const res = await fetch(`${SITE_URL}/sitemap.xml`, { headers: { "User-Agent": "a2jersey-indexnow" } });
  if (!res.ok) {
    console.log("[indexnow] sitemap fetch failed", res.status);
    return new Response(JSON.stringify({ ok: false, step: "sitemap", status: res.status }), { status: 502 });
  }
  const urls = recentUrls(parseSitemap(await res.text()), since);
  if (urls.length === 0) {
    console.log("[indexnow] no changed urls since", since);
    return new Response(JSON.stringify({ ok: true, submitted: 0, since }), { status: 200 });
  }
  const body = JSON.stringify(indexNowPayload(SITE_URL, urls));
  const results = await Promise.all(
    INDEXNOW_ENDPOINTS.map(async (endpoint) => {
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body,
        });
        return { endpoint, status: r.status };
      } catch (err) {
        return { endpoint, status: 0, error: String(err) };
      }
    })
  );
  // 200/202 = 접수. 403 = 키 파일 불일치, 422 = 호스트·주소 불일치, 429 = 너무 잦음.
  console.log("[indexnow]", since, urls.length, JSON.stringify(results));
  const ok = results.some((r) => r.status === 200 || r.status === 202);
  return new Response(JSON.stringify({ ok, since, submitted: urls.length, results }), {
    status: ok ? 200 : 502,
    headers: { "content-type": "application/json" },
  });
}

// 매일 21:20 UTC = 06:20 KST.
export const config: Config = { schedule: "20 21 * * *" };
