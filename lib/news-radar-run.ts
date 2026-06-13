import { createClient } from "@supabase/supabase-js";
import { parseRss } from "./news-radar";
import { activeFeeds } from "./news-radar-feeds";
import { buildSummaryPrompt, parseSummary } from "./news-radar-summary";
import { fetchArticleText } from "./news-radar-fetch";
import {
  buildScoringPrompt,
  parseScoredArray,
  mergeScored,
  rankCandidates,
  type FieldCandidate,
  type ScoredCandidate,
} from "./news-radar-strategy";
import { PET_CONTENT_ENABLED } from "./news-radar-flags";

// 소식 레이더 실행(주간 스케줄 + 관리자 즉시실행 공용).
//   publisher RSS 피드 수집 → OpenAI 5기준 점수화 → 합산 정렬 TOP3 → 원문 충실 요약(enrich) → secret RPC 적재(중복 무시, 대기 상태).
//   펫 게이트: PET_CONTENT_ENABLED=false 면 자동 수집은 사람 유제품 피드만(펫 제외).

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const PER_FIELD_MAX = 3; // 피드당 후보 상한(토큰·비용 관리)
const TOTAL_MAX = 24; // 전체 후보 상한
const TOP_N = 3; // 적재 건수
const MIN_TEXT = 120; // enrich 요약에 충분한 본문 최소 길이(자)
const RECENCY_DAYS = 30; // 최근성 가드(일)

// 활성 피드 순차 수집(피드당 PER_FIELD_MAX 까지, 전체 TOTAL_MAX 상한). 최근 30일.
//   PET_CONTENT_ENABLED=false 면 펫 피드 제외(사람 유제품만).
export async function collectFeedCandidates(): Promise<FieldCandidate[]> {
  const cutoff = Date.now() - RECENCY_DAYS * 24 * 60 * 60 * 1000;
  const out: FieldCandidate[] = [];
  for (const feed of activeFeeds(PET_CONTENT_ENABLED)) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (news-radar)" },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      let perFeed = 0;
      for (const it of parseRss(xml, PER_FIELD_MAX)) {
        const t = Date.parse(it.pubDate);
        // pubDate 파싱 가능하면 30일 이내만, 파싱 불가/빈 값은 유지.
        if (!Number.isNaN(t) && t < cutoff) continue;
        out.push({ ...it, source: feed.source, field: feed.label, fieldPriority: feed.priority, category: feed.category });
        perFeed += 1;
        if (perFeed >= PER_FIELD_MAX) break;
      }
    } catch {
      // 개별 피드 실패는 무시
    }
  }
  return out.slice(0, TOTAL_MAX);
}

// 자유 검색어 → 활성 피드에서 제목·본문에 검색어가 포함된 후보만 필터(관리자 자유 검색용).
export async function collectTermCandidates(term: string): Promise<FieldCandidate[]> {
  const all = await collectFeedCandidates();
  const t = term.toLowerCase();
  return all.filter((c) => c.title.toLowerCase().includes(t) || c.contentText.toLowerCase().includes(t));
}

// 선정된 후보를 원문 본문 기반으로 한 문단 한글 번역·요약(enrich). 실패 시 입력 요약 폴백.
//   contentText 가 충분하면 Jina 미호출, 빈약하면 Jina Reader 로 본문 보강.
export async function enrichSummary(
  item: { title_ko: string; summary_ko: string; source_url: string; original_title?: string; field?: string; contentText?: string },
  cfg: { apiKey: string; model: string; jinaKey?: string; fetchImpl?: typeof fetch }
): Promise<{ title_ko: string; summary_ko: string }> {
  const fallback = { title_ko: item.title_ko, summary_ko: item.summary_ko };
  try {
    let text = (item.contentText ?? "").trim();
    if (text.length < MIN_TEXT) {
      text = (await fetchArticleText(item.source_url, { apiKey: cfg.jinaKey, fetchImpl: cfg.fetchImpl })) ?? "";
    }
    if (text.length < MIN_TEXT) return fallback;
    const res = await (cfg.fetchImpl ?? fetch)(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: "당신은 낙농·유제품 뉴스 번역·요약가입니다. 지시한 JSON 으로만 답합니다." },
          { role: "user", content: buildSummaryPrompt(text, { originalTitle: item.original_title, topic: item.field }) },
        ],
      }),
    });
    const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
    if (!res.ok || !json) return fallback;
    return parseSummary(json.choices?.[0]?.message?.content ?? "") ?? fallback;
  } catch {
    return fallback;
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
  jinaKey?: string;
};

export async function runNewsRadar(cfg: RadarRunConfig): Promise<RadarRunResult> {
  if (!cfg.supabaseUrl || !cfg.anon || !cfg.secret || !cfg.apiKey) {
    return { ok: false, status: "error", reason: "not_configured" };
  }

  const candidates = await collectFeedCandidates();
  if (candidates.length === 0) return { ok: true, status: "no_candidates" };

  const scored = await scoreCandidates(candidates, { apiKey: cfg.apiKey, model: cfg.model, topN: TOP_N });
  if (!scored.ok) return { ok: false, status: "error", reason: scored.reason };
  if (scored.ranked.length === 0) return { ok: true, status: "no_relevant" };

  // 원문 충실 요약(enrich) — 전체 18초 데드라인. 실패·시간초과 시 점수화 요약 유지.
  const enriched = (await Promise.race([
    Promise.all(scored.ranked.map((c) => enrichSummary(c, { apiKey: cfg.apiKey, model: cfg.model, jinaKey: cfg.jinaKey }))),
    new Promise<null>((r) => setTimeout(() => r(null), 18000)),
  ])) as { title_ko: string; summary_ko: string }[] | null;
  const finals = scored.ranked.map((c, i) =>
    enriched?.[i] ? { ...c, title_ko: enriched[i].title_ko, summary_ko: enriched[i].summary_ko } : c
  );

  const sb = createClient(cfg.supabaseUrl, cfg.anon);
  const titles: string[] = [];
  let inserted = 0;
  for (const c of finals) {
    const { data, error } = await sb.rpc("news_radar_insert", {
      p_secret: cfg.secret,
      p_title_ko: c.title_ko,
      p_summary_ko: c.summary_ko,
      p_source_name: c.source_name,
      p_source_url: c.source_url,
      p_original_title: c.original_title,
      p_topic: c.field,
      p_category: c.category,
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
