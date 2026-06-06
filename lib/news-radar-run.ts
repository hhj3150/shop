import { createClient } from "@supabase/supabase-js";
import { googleNewsRssUrl, parseRss } from "./news-radar";
import {
  RADAR_FIELDS,
  buildScoringPrompt,
  parseScoredArray,
  mergeScored,
  rankCandidates,
  type FieldCandidate,
  type ScoredCandidate,
} from "./news-radar-strategy";

// 소식 레이더 실행(주간 스케줄 + 관리자 즉시실행 공용).
//   8분야 RSS 검색 → OpenAI 5기준 점수화 → 합산 정렬 TOP3 → secret RPC 적재(중복 무시, 대기 상태).

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const PER_FIELD_MAX = 3; // 분야당 후보 상한(토큰·비용 관리)
const TOTAL_MAX = 24; // 전체 후보 상한
const TOP_N = 3; // 적재 건수

// 8분야 순차 수집(분야당 PER_FIELD_MAX 까지, 전체 TOTAL_MAX 상한). 최근 30일.
export async function collectFieldCandidates(): Promise<FieldCandidate[]> {
  const out: FieldCandidate[] = [];
  for (const f of RADAR_FIELDS) {
    let perField = 0;
    for (const q of f.queries) {
      if (perField >= PER_FIELD_MAX) break;
      try {
        const res = await fetch(googleNewsRssUrl(q, 30), {
          headers: { "User-Agent": "Mozilla/5.0 (news-radar)" },
        });
        if (!res.ok) continue;
        const xml = await res.text();
        for (const it of parseRss(xml, PER_FIELD_MAX - perField)) {
          out.push({ ...it, field: f.label, fieldPriority: f.priority });
          perField += 1;
          if (perField >= PER_FIELD_MAX) break;
        }
      } catch {
        // 개별 쿼리 실패는 무시
      }
    }
  }
  return out.slice(0, TOTAL_MAX);
}

// 단일 검색어 → 단일 쿼리 후보(관리자 자유 검색용). 분야 라벨은 "검색", 우선순위 중간(4).
export async function collectTermCandidates(term: string): Promise<FieldCandidate[]> {
  try {
    const res = await fetch(googleNewsRssUrl(term, 30), {
      headers: { "User-Agent": "Mozilla/5.0 (news-radar)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 8).map((it) => ({ ...it, field: "검색", fieldPriority: 4 }));
  } catch {
    return [];
  }
}

// 후보 → OpenAI 점수화 → 병합 → 정렬 TOP. 외부 호출(OpenAI). 라우트·run 공용.
export async function scoreCandidates(
  candidates: FieldCandidate[],
  cfg: { apiKey: string; model: string; searchTerm?: string; topN: number }
): Promise<{ ok: boolean; ranked: ScoredCandidate[]; reason?: string }> {
  if (candidates.length === 0) return { ok: true, ranked: [] };
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: "당신은 낙농·유제품 마케팅 뉴스 큐레이터입니다. 지시한 JSON 배열로만 답합니다." },
          { role: "user", content: buildScoringPrompt(candidates, { searchTerm: cfg.searchTerm }) },
        ],
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok || !json) {
      return { ok: false, ranked: [], reason: json?.error?.message ?? `openai_http_${res.status}` };
    }
    const raw = parseScoredArray(json.choices?.[0]?.message?.content ?? "");
    const merged = mergeScored(raw, candidates);
    return { ok: true, ranked: rankCandidates(merged, cfg.topN) };
  } catch (e) {
    return { ok: false, ranked: [], reason: e instanceof Error ? e.message : "openai_failed" };
  }
}

export type RadarRunResult = {
  ok: boolean;
  status: "inserted" | "duplicate" | "no_relevant" | "no_candidates" | "error";
  insertedCount?: number;
  titles?: string[];
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

  const candidates = await collectFieldCandidates();
  if (candidates.length === 0) return { ok: true, status: "no_candidates" };

  const scored = await scoreCandidates(candidates, { apiKey: cfg.apiKey, model: cfg.model, topN: TOP_N });
  if (!scored.ok) return { ok: false, status: "error", reason: scored.reason };
  if (scored.ranked.length === 0) return { ok: true, status: "no_relevant" };

  const sb = createClient(cfg.supabaseUrl, cfg.anon);
  const titles: string[] = [];
  let inserted = 0;
  for (const c of scored.ranked) {
    const { data, error } = await sb.rpc("news_radar_insert", {
      p_secret: cfg.secret,
      p_title_ko: c.title_ko,
      p_summary_ko: c.summary_ko,
      p_source_name: c.source_name,
      p_source_url: c.source_url,
      p_original_title: c.original_title,
      p_topic: c.field,
      p_published_at: null,
    });
    if (error) return { ok: false, status: "error", reason: error.message, insertedCount: inserted, titles };
    if (data) {
      inserted += 1;
      titles.push(c.title_ko);
    }
  }

  if (inserted > 0) return { ok: true, status: "inserted", insertedCount: inserted, titles };
  return { ok: true, status: "duplicate", insertedCount: 0, titles: [] };
}
