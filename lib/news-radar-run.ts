import { createClient } from "@supabase/supabase-js";
import {
  RADAR_QUERIES,
  googleNewsRssUrl,
  parseRss,
  buildRadarPrompt,
  type RssItem,
} from "./news-radar";

// 소식 레이더 실행 로직(스케줄 함수 + 관리자 즉시실행 공용).
//   RSS 검색 → OpenAI 1건 선별·한글 번역 → secret 게이트 RPC 저장.

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
    } catch {
      // 개별 쿼리 실패는 무시
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

export type RadarRunResult = {
  ok: boolean;
  status: "inserted" | "duplicate" | "no_relevant" | "no_candidates" | "error";
  title?: string;
  reason?: string;
};

export type RadarRunConfig = {
  supabaseUrl: string;
  anon: string;
  secret: string;
  apiKey: string;
  model: string;
};

export async function runNewsRadar(cfg: RadarRunConfig): Promise<RadarRunResult> {
  if (!cfg.supabaseUrl || !cfg.anon || !cfg.secret || !cfg.apiKey) {
    return { ok: false, status: "error", reason: "not_configured" };
  }

  const candidates = await collectCandidates();
  if (candidates.length === 0) return { ok: true, status: "no_candidates" };

  let picked: Record<string, unknown> | null = null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
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
      return { ok: false, status: "error", reason: json?.error?.message ?? `openai_http_${res.status}` };
    }
    picked = extractJson(json.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    return { ok: false, status: "error", reason: e instanceof Error ? e.message : "openai_failed" };
  }

  if (!picked || picked.relevant === false || !picked.title_ko || !picked.source_url) {
    return { ok: true, status: "no_relevant" };
  }

  const sb = createClient(cfg.supabaseUrl, cfg.anon);
  const { data, error } = await sb.rpc("news_radar_insert", {
    p_secret: cfg.secret,
    p_title_ko: String(picked.title_ko),
    p_summary_ko: String(picked.summary_ko ?? ""),
    p_source_name: String(picked.source_name ?? ""),
    p_source_url: String(picked.source_url),
    p_original_title: String(picked.original_title ?? ""),
    p_topic: String(picked.topic ?? ""),
    p_published_at: null,
  });
  if (error) {
    return { ok: false, status: "error", reason: error.message };
  }
  return data
    ? { ok: true, status: "inserted", title: String(picked.title_ko) }
    : { ok: true, status: "duplicate", title: String(picked.title_ko) };
}
