import type { Config } from "@netlify/functions";
import { runNewsRadar } from "../../lib/news-radar-run";

// 주 1회: 8개 분야를 검색·점수화해 TOP3 뉴스를 한글 번역·'대기' 적재(관리자 검토 후 게시).
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
