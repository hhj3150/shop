import type { Config } from "@netlify/functions";
import { runNewsRadar } from "../../lib/news-radar-run";

// 주 1회: A2·저지·헤이밀크·동물복지·저탄소 낙농 뉴스 1건을 한글 번역·저장(관리자 피드 + 고객 노출).
//   실행 로직은 lib/news-radar-run 공용(관리자 즉시실행과 동일).

export default async function handler(): Promise<Response> {
  const r = await runNewsRadar({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    secret: process.env.NEWS_RADAR_SECRET ?? "",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  });
  console.log("[news-radar]", r.status, r.reason ?? r.titles?.[0] ?? "");
  return new Response(JSON.stringify(r), {
    status: r.ok ? 200 : 502,
    headers: { "content-type": "application/json" },
  });
}

// 매주 월요일 00:00 UTC = 09:00 KST 월요일.
export const config: Config = { schedule: "0 0 * * 1" };
