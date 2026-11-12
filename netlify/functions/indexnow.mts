import type { Config } from "@netlify/functions";
import { SITE_URL } from "../../lib/site";
import {
  INDEXNOW_ENDPOINT,
  parseSitemap,
  urlsChangedOn,
  indexNowPayload,
} from "../../lib/seo/indexnow";

// 매일 06:20 KST: 운영 sitemap.xml 에서 lastmod 가 '어제(KST)'인 주소만 골라 IndexNow 로 한 번 알린다.
//   수정일은 lib/seo/lastmod.ts 가 단일 출처 — 배포일 날짜로 적으면 다음 날 아침에 한 번 알림이 간다.
//   하루치만 고르므로 같은 주소를 이틀 연속 다시 보내지 않는다(엔진 권고: 바뀌지 않은 주소 재제출 금지).
//   lastmod 보다 늦게 배포된 변경은 여기서 빠지므로 배포 후 수동으로: node scripts/indexnow.mjs --since <날짜>
//   예약 함수는 배포된 운영 사이트에서만 돈다(Netlify).
function kstDaysAgo(days: number): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000);
  return kst.toISOString().slice(0, 10);
}

export default async function handler(): Promise<Response> {
  const day = kstDaysAgo(1);
  const res = await fetch(`${SITE_URL}/sitemap.xml`, { headers: { "User-Agent": "a2jersey-indexnow" } });
  if (!res.ok) {
    console.log("[indexnow] sitemap fetch failed", res.status);
    return new Response(JSON.stringify({ ok: false, step: "sitemap", status: res.status }), { status: 502 });
  }
  const urls = urlsChangedOn(parseSitemap(await res.text()), day);
  if (urls.length === 0) {
    console.log("[indexnow] no urls changed on", day);
    return new Response(JSON.stringify({ ok: true, submitted: 0, day }), { status: 200 });
  }
  let status = 0;
  try {
    const r = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowPayload(SITE_URL, urls)),
    });
    status = r.status;
  } catch (err) {
    console.log("[indexnow] post failed", String(err));
  }
  // 200/202 = 접수. 403 = 키 파일 불일치, 422 = 호스트·주소 불일치, 429 = 너무 잦음.
  console.log("[indexnow]", day, urls.length, status);
  const ok = status === 200 || status === 202;
  return new Response(JSON.stringify({ ok, day, submitted: urls.length, status }), {
    status: ok ? 200 : 502,
    headers: { "content-type": "application/json" },
  });
}

// 매일 21:20 UTC = 06:20 KST.
export const config: Config = { schedule: "20 21 * * *" };
