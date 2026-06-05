import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import {
  RADAR_QUERIES,
  googleNewsRssUrl,
  parseRss,
  buildRadarPrompt,
  type RssItem,
} from "../../lib/news-radar.ts";

// 주 1회: A2·저지·헤이밀크·동물복지·저탄소 낙농 뉴스를 검색해 가장 연관성 높은 1건을
//   OpenAI 로 골라 한글 번역·요약 후 news_radar 에 저장(관리자 피드 + 고객 노출).
//   외부 의존: Google News RSS(무료) + OpenAI. 저장은 secret 게이트 RPC.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

async function collectCandidates(): Promise<Array<RssItem & { topic: string }>> {
  const out: Array<RssItem & { topic: string }> = [];
  for (const { topic, q } of RADAR_QUERIES) {
    try {
      const res = await fetch(googleNewsRssUrl(q), {
        headers: { "User-Agent": "Mozilla/5.0 (news-radar)" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const it of parseRss(xml, 3)) out.push({ ...it, topic });
    } catch (e) {
      console.warn("[news-radar] RSS 실패:", topic, e);
    }
  }
  return out.slice(0, 15);
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.NEWS_RADAR_SECRET;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  if (!url || !anon || !secret || !apiKey) {
    console.warn("[news-radar] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const candidates = await collectCandidates();
  if (candidates.length === 0) {
    console.warn("[news-radar] 후보 없음");
    return new Response("no candidates");
  }

  // OpenAI 로 가장 연관성 높은 1건 선별 + 한글 번역·요약.
  let picked: Record<string, unknown> | null = null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "당신은 낙농 산업 뉴스 큐레이터입니다. 지시한 JSON 형식으로만 답합니다." },
          { role: "user", content: buildRadarPrompt(candidates) },
        ],
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok || !json) {
      console.error("[news-radar] OpenAI 오류:", json?.error?.message ?? res.status);
      return new Response("openai error", { status: 502 });
    }
    picked = extractJson(json.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    console.error("[news-radar] OpenAI 호출 실패:", e);
    return new Response("openai failed", { status: 502 });
  }

  if (!picked || picked.relevant === false || !picked.title_ko || !picked.source_url) {
    console.log("[news-radar] 적절한 소식 없음");
    return new Response("no relevant news");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("news_radar_insert", {
    p_secret: secret,
    p_title_ko: String(picked.title_ko),
    p_summary_ko: String(picked.summary_ko ?? ""),
    p_source_name: String(picked.source_name ?? ""),
    p_source_url: String(picked.source_url),
    p_original_title: String(picked.original_title ?? ""),
    p_topic: String(picked.topic ?? ""),
    p_published_at: null,
  });
  if (error) {
    console.error("[news-radar] 저장 실패:", error.message);
    return new Response("insert failed", { status: 502 });
  }
  console.log("[news-radar] 저장:", data ? "신규 1건" : "중복(무시)");
  return new Response(`ok ${data ? "inserted" : "duplicate"}`);
}

// 매주 월요일 00:00 UTC = 09:00 KST 월요일.
export const config: Config = { schedule: "0 0 * * 1" };
