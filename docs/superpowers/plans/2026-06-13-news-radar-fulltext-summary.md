# 업계소식레이더 원문 충실 요약 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소스를 publisher 직접 RSS 피드로 전환해 실제 기사 텍스트를 확보하고, 영어 못 읽는 소비자를 위해 한국어 한 문단(4-7문장) 요약을 생성한다(자동 주간 + 관리자 수동 추가 양쪽).

**Architecture:** 큐레이션 피드 레지스트리(`news-radar-feeds.ts`)에서 실링크+영문 텍스트(`description`)를 수집(`parseRss`에 `contentText` 추가) → 기존 5기준 점수화로 TOP3 선별 → 선별분만 영문 텍스트를 한국어 한 문단으로 요약(`enrichSummary`: RSS 텍스트 우선, 빈약하면 Jina 보강) → 기존 RPC 적재. 수동 검색은 피드 필터로, 수동 추가는 서버 라우트로 통일.

**Tech Stack:** TypeScript, vitest, OpenAI(gpt-5.4-mini), Jina Reader(옵션). SQL 변경 없음.

**Spec:** `docs/superpowers/specs/2026-06-13-news-radar-fulltext-summary-design.md`

**불변식:** 폴백 우선 — 피드 실패·텍스트 빈약+Jina 실패·요약 파싱 실패 시 기존 점수화 요약 유지(레이더 무중단).

**테스트:** `npx vitest run <파일>` · 타입체크 `npx tsc --noEmit`

---

## File Structure
- Create `lib/news-radar-feeds.ts` — 피드 레지스트리 + `activeFeeds`.
- Create `lib/news-radar-summary.ts` — `buildSummaryPrompt`/`parseSummary`(순수).
- Create `lib/news-radar-fetch.ts` — `fetchArticleText`(Jina, 주입형).
- Modify `lib/news-radar.ts` — `parseRss` `contentText` 추가; orphan 제거(googleNewsRssUrl/RADAR_QUERIES/buildRadarPrompt).
- Modify `lib/news-radar-strategy.ts` — `FieldCandidate`/`ScoredCandidate`에 `contentText`; `mergeScored` 보정; `RADAR_FIELDS.queries` 제거(테마 라벨 유지).
- Modify `lib/news-radar-run.ts` — `collectFeedCandidates`(대체), `collectTermCandidates`(피드 필터), `enrichSummary`, `runNewsRadar` enrich + `jinaKey`.
- Modify `app/api/admin/news-radar-run/route.ts`, `netlify/functions/news-radar.mts`, `app/api/admin/news-radar-search/route.ts` — `jinaKey` 전달.
- Create `app/api/admin/news-radar-add/route.ts` — 수동 추가 서버화.
- Modify `components/NewsRadarAdminFeed.tsx` — `addDraft` → 라우트 POST.
- Tests: `lib/news-radar-feeds.test.ts`, `news-radar.test.ts`(추가), `news-radar-summary.test.ts`, `news-radar-fetch.test.ts`, `news-radar-strategy.test.ts`(추가), `news-radar-run.test.ts`(추가/신규).

---

## Chunk 1: 순수·데이터 기반 (feeds, parseRss, summary, fetch)

### Task 1: 피드 레지스트리 `lib/news-radar-feeds.ts`
**Files:** Create `lib/news-radar-feeds.ts`, Test `lib/news-radar-feeds.test.ts`

- [ ] **Step 1: 실패 테스트**
```ts
import { describe, it, expect } from "vitest";
import { RADAR_FEEDS, activeFeeds } from "./news-radar-feeds";

describe("news-radar-feeds", () => {
  it("스타터 피드는 RSS URL·source·category 를 갖는다", () => {
    expect(RADAR_FEEDS.length).toBeGreaterThanOrEqual(3);
    for (const f of RADAR_FEEDS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.source).toBeTruthy();
      expect(["human", "pet"]).toContain(f.category);
    }
  });
  it("activeFeeds(false)는 펫 피드를 제외", () => {
    expect(activeFeeds(false).every((f) => f.category === "human")).toBe(true);
  });
  it("activeFeeds(true)는 전체(펫 포함 시) 반환", () => {
    expect(activeFeeds(true).length).toBe(RADAR_FEEDS.length);
  });
});
```
- [ ] **Step 2: 실패 확인** `npx vitest run lib/news-radar-feeds.test.ts` → FAIL.
- [ ] **Step 3: 구현**
```ts
// 업계소식레이더 소스 — publisher 직접 RSS 피드(실링크 + 영문 텍스트).
//   ⚠ RSS(<item>/<link>) 전용. Atom(<entry>) 피드는 현재 parseRss 가 처리 못 하므로 추가 금지.
//   source = 매체명(피드가 <source> 태그 미제공 → 여기서 부여, 출처 표기에 사용).
export type RadarFeed = {
  url: string;
  label: string; // 한글 topic 표시
  source: string; // 매체명
  priority: number; // 1(최우선)~8
  category: "human" | "pet";
};

export const RADAR_FEEDS: RadarFeed[] = [
  { url: "https://phys.org/rss-feed/biology-news/agriculture/", label: "농업·낙농", source: "Phys.org", priority: 2, category: "human" },
  { url: "https://www.sciencedaily.com/rss/plants_animals/agriculture_and_food.xml", label: "농식품", source: "ScienceDaily", priority: 3, category: "human" },
  { url: "https://www.sciencedaily.com/rss/health_medicine/nutrition.xml", label: "영양·건강", source: "ScienceDaily", priority: 5, category: "human" },
];

export function activeFeeds(petEnabled: boolean): RadarFeed[] {
  return petEnabled ? RADAR_FEEDS : RADAR_FEEDS.filter((f) => f.category !== "pet");
}
```
- [ ] **Step 4: 통과** `npx vitest run lib/news-radar-feeds.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add lib/news-radar-feeds.ts lib/news-radar-feeds.test.ts && git commit -m "feat: 소식레이더 publisher 피드 레지스트리"`

### Task 2: `parseRss` 본문 텍스트 추출
**Files:** Modify `lib/news-radar.ts` (RssItem ~27, parseRss ~41), Test `lib/news-radar.test.ts`(추가)

- [ ] **Step 1: 실패 테스트** (기존 테스트 보존, describe 추가)
```ts
import { parseRss } from "./news-radar";
describe("parseRss contentText", () => {
  it("description 을 contentText 로 추출(HTML/엔티티 제거)", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link>
      <description><![CDATA[<p>Heat &amp; cows <b>rise</b></p>]]></description></item></channel></rss>`;
    const out = parseRss(xml);
    expect(out[0].contentText).toBe("Heat & cows rise");
  });
  it("content:encoded 가 있으면 우선", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link>
      <description>short</description>
      <content:encoded><![CDATA[<p>Full body text</p>]]></content:encoded></item></channel></rss>`;
    expect(parseRss(xml)[0].contentText).toBe("Full body text");
  });
  it("본문 없으면 빈문자", () => {
    const xml = `<rss><channel><item><title>T</title><link>https://p/a</link></item></channel></rss>`;
    expect(parseRss(xml)[0].contentText).toBe("");
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL(contentText 없음).
- [ ] **Step 3: 구현**
  - `RssItem` 타입에 `contentText: string;` 추가.
  - `parseRss` 의 item push 에 contentText 계산 추가. `grab` 는 `content:encoded` 같은 네임스페이스 태그도
    정규식이 `[^>]*` 라 매칭됨(태그명에 `:` 포함). 본문 평문화 헬퍼 추가:
```ts
function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
```
  - push 부:
```ts
    const contentRaw = grab("content:encoded") || grab("description");
    items.push({
      title, link, source: grab("source"), pubDate: grab("pubDate"),
      contentText: contentRaw ? stripHtml(contentRaw) : "",
    });
```
  - 주의: `decodeEntities` 가 이미 CDATA 제거함. `stripHtml` 은 태그 제거 후 `decodeEntities`. `grab` 내부에서
    이미 `decodeEntities` 적용되므로 CDATA·엔티티가 풀린 상태 → `stripHtml` 은 태그만 더 제거하면 됨.
    (구현 시 이중 디코드로 깨지지 않게 `grab` 가공 전/후 확인. 테스트가 기대값을 고정.)
- [ ] **Step 4: 통과** `npx vitest run lib/news-radar.test.ts` → PASS(기존 포함).
- [ ] **Step 5: Commit** `git add lib/news-radar.ts lib/news-radar.test.ts && git commit -m "feat: parseRss 본문 텍스트(contentText) 추출"`

### Task 3: 요약 프롬프트 `lib/news-radar-summary.ts`
**Files:** Create `lib/news-radar-summary.ts`, Test `lib/news-radar-summary.test.ts`

- [ ] **Step 1: 실패 테스트**
```ts
import { describe, it, expect } from "vitest";
import { buildSummaryPrompt, parseSummary } from "./news-radar-summary";

describe("buildSummaryPrompt", () => {
  it("영문 텍스트·한 문단/4-7문장·효능금지·JSON 지시 포함", () => {
    const p = buildSummaryPrompt("Cows produce A2 milk...", { originalTitle: "A2", topic: "A2 우유" });
    expect(p).toContain("Cows produce A2 milk");
    expect(p).toMatch(/4-7문장|한 문단/);
    expect(p).toMatch(/효능|광고/);
    expect(p).toContain("title_ko");
    expect(p).toContain("summary_ko");
  });
});
describe("parseSummary", () => {
  it("정상 JSON", () => {
    expect(parseSummary('{"title_ko":"제목","summary_ko":"요약"}')).toEqual({ title_ko: "제목", summary_ko: "요약" });
  });
  it("코드펜스 허용", () => {
    expect(parseSummary('```json\n{"title_ko":"ㄱ","summary_ko":"ㄴ"}\n```')?.summary_ko).toBe("ㄴ");
  });
  it("빈/누락 → null", () => {
    expect(parseSummary("noop")).toBeNull();
    expect(parseSummary('{"title_ko":""}')).toBeNull();
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현**
```ts
// 영문 기사 텍스트 → 한국어 한 문단 요약 프롬프트·파서(순수).
export function buildSummaryPrompt(
  englishText: string,
  meta: { originalTitle?: string; topic?: string }
): string {
  return [
    "아래 영문 기사 내용을 자연스러운 한국어로 번역·요약하세요.",
    "분량: 한 문단(4-7문장, 대략 300-500자). 독자가 영어 원문을 읽지 않아도 핵심을 이해하도록 사실 위주로.",
    "금지: 의견·과장·효능 단정·광고성 표현(식품표시광고법). 본문에 없는 내용 추가 금지.",
    meta.topic ? `주제: ${meta.topic}` : "",
    meta.originalTitle ? `원문 제목: ${meta.originalTitle}` : "",
    "",
    "원문 내용:",
    englishText,
    "",
    'JSON 으로만 답하세요(다른 텍스트 금지): {"title_ko":"간결한 한글 제목","summary_ko":"한 문단 한글 요약"}',
  ].filter(Boolean).join("\n");
}

export function parseSummary(content: string): { title_ko: string; summary_ko: string } | null {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as { title_ko?: unknown; summary_ko?: unknown };
    const title_ko = typeof o.title_ko === "string" ? o.title_ko.trim() : "";
    const summary_ko = typeof o.summary_ko === "string" ? o.summary_ko.trim() : "";
    if (!title_ko || !summary_ko) return null;
    return { title_ko, summary_ko };
  } catch {
    return null;
  }
}
```
- [ ] **Step 4: 통과** → PASS.
- [ ] **Step 5: Commit** `git add lib/news-radar-summary.ts lib/news-radar-summary.test.ts && git commit -m "feat: 소식레이더 한 문단 한글 요약 프롬프트·파서"`

### Task 4: Jina 본문 보강 `lib/news-radar-fetch.ts`
**Files:** Create `lib/news-radar-fetch.ts`, Test `lib/news-radar-fetch.test.ts`

- [ ] **Step 1: 실패 테스트** (주입 fetch)
```ts
import { describe, it, expect, vi } from "vitest";
import { fetchArticleText } from "./news-radar-fetch";

const okFetch = (body: string) => vi.fn(async () => new Response(body, { status: 200 }));

describe("fetchArticleText", () => {
  it("r.jina.ai URL 로 요청, 본문 반환", async () => {
    const f = okFetch("article body");
    const t = await fetchArticleText("https://p/a", { fetchImpl: f as unknown as typeof fetch });
    expect(t).toBe("article body");
    expect((f.mock.calls[0][0] as string)).toBe("https://r.jina.ai/https://p/a");
  });
  it("apiKey 있으면 Authorization 헤더", async () => {
    const f = okFetch("x");
    await fetchArticleText("https://p/a", { apiKey: "K", fetchImpl: f as unknown as typeof fetch });
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer K");
  });
  it("maxChars 절단", async () => {
    const t = await fetchArticleText("https://p/a", { maxChars: 5, fetchImpl: okFetch("0123456789") as unknown as typeof fetch });
    expect(t).toBe("01234");
  });
  it("비200·빈본문·예외 → null", async () => {
    expect(await fetchArticleText("https://p/a", { fetchImpl: (vi.fn(async () => new Response("x", { status: 500 }))) as unknown as typeof fetch })).toBeNull();
    expect(await fetchArticleText("https://p/a", { fetchImpl: (vi.fn(async () => new Response("", { status: 200 }))) as unknown as typeof fetch })).toBeNull();
    expect(await fetchArticleText("https://p/a", { fetchImpl: (vi.fn(async () => { throw new Error("net"); })) as unknown as typeof fetch })).toBeNull();
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현**
```ts
// 원문 본문을 Jina Reader 로 가져온다(publisher URL 전용, 옵션 보강). 실패 시 null(호출부 폴백).
export async function fetchArticleText(
  url: string,
  cfg?: { apiKey?: string; maxChars?: number; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<string | null> {
  const f = cfg?.fetchImpl ?? fetch;
  const maxChars = cfg?.maxChars ?? 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg?.timeoutMs ?? 8000);
  try {
    const headers: Record<string, string> = {};
    if (cfg?.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await f(`https://r.jina.ai/${url}`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    return text.slice(0, maxChars);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```
- [ ] **Step 4: 통과** → PASS.
- [ ] **Step 5: Commit** `git add lib/news-radar-fetch.ts lib/news-radar-fetch.test.ts && git commit -m "feat: 소식레이더 Jina 본문 보강 유틸"`

---

## Chunk 2: 파이프라인 통합 (strategy, run, routes, 컴포넌트)

### Task 5: `strategy.ts` — contentText 스레딩 + 출처 보정
**Files:** Modify `lib/news-radar-strategy.ts`, Test `lib/news-radar-strategy.test.ts`(추가)

- [ ] **Step 1: 실패 테스트**
```ts
import { mergeScored } from "./news-radar-strategy";
describe("mergeScored contentText·source", () => {
  const cand = [{ title: "T", link: "https://p/a", source: "Phys.org", pubDate: "", contentText: "BODY", field: "농업", fieldPriority: 2, category: "human" as const }];
  it("contentText 보존 + source 는 피드값 우선", () => {
    const raw = [{ index: 0, title_ko: "ㄱ", summary_ko: "ㄴ", source_name: "모델추정", scores: {} }];
    const m = mergeScored(raw, cand);
    expect(m[0].contentText).toBe("BODY");
    expect(m[0].source_name).toBe("Phys.org"); // 피드 source 우선
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL(contentText 미보존 / source_name=모델값).
- [ ] **Step 3: 구현**
  - `FieldCandidate` 는 `RssItem` 확장이라 `contentText` 자동 포함(Task2). `ScoredCandidate` 에 `contentText: string;` 추가.
  - `mergeScored` 의 push 객체에 `contentText: src.contentText,` 추가.
  - 출처 우선순위 뒤집기: `source_name: str(r.source_name) || src.source` → **`source_name: src.source || str(r.source_name)`**
    (피드 레지스트리 source 가 권위, 모델 추정은 폴백).
- [ ] **Step 4: 통과** `npx vitest run lib/news-radar-strategy.test.ts` → PASS.
- [ ] **Step 5: Commit** `git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts && git commit -m "feat: 점수화에 contentText 보존 + 피드 출처 우선"`

### Task 6: `news-radar-run.ts` — 피드 수집·enrich + cleanup
**Files:** Modify `lib/news-radar-run.ts`, `lib/news-radar.ts`(orphan 제거), `lib/news-radar-strategy.ts`(RADAR_FIELDS.queries 제거), Test `lib/news-radar-run.test.ts`

- [ ] **Step 1: 실패 테스트** (순수 가능한 부분 위주 — collectTermCandidates 필터, enrichSummary 폴백/교체; 주입형)
```ts
import { describe, it, expect, vi } from "vitest";
import { enrichSummary } from "./news-radar-run";

describe("enrichSummary", () => {
  const base = { title_ko: "원제목", summary_ko: "원요약", source_url: "https://p/a", original_title: "OT", field: "농업", contentText: "" };
  const okOpenAI = (json: string) =>
    vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: json } }] }), { status: 200 }));

  it("contentText 충분 → Jina 미호출, 요약 교체", async () => {
    const f = okOpenAI('{"title_ko":"새제목","summary_ko":"새요약"}');
    const out = await enrichSummary({ ...base, contentText: "x".repeat(300) }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "새제목", summary_ko: "새요약" });
    // r.jina.ai 호출 없음
    expect((f.mock.calls).every((c) => !String(c[0]).includes("r.jina.ai"))).toBe(true);
  });
  it("요약 파싱 실패 → 입력 폴백", async () => {
    const f = okOpenAI("noop");
    const out = await enrichSummary({ ...base, contentText: "x".repeat(300) }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "원제목", summary_ko: "원요약" });
  });
  it("contentText 빈약 + Jina 실패 → 입력 폴백", async () => {
    const f = vi.fn(async (u: string) => u.includes("r.jina.ai") ? new Response("", { status: 500 }) : new Response("{}", { status: 200 }));
    const out = await enrichSummary({ ...base, contentText: "" }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "원제목", summary_ko: "원요약" });
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL(enrichSummary 없음).
- [ ] **Step 3: 구현**
  - import: `activeFeeds` from `./news-radar-feeds`, `buildSummaryPrompt, parseSummary` from `./news-radar-summary`, `fetchArticleText` from `./news-radar-fetch`. parseRss 는 기존.
  - **`collectFeedCandidates()`**(`collectFieldCandidates` 대체): `activeFeeds(PET_CONTENT_ENABLED)` 순회 → `fetch(feed.url)` →
    `parseRss(xml, PER_FIELD_MAX)` → recency 가드(`Date.parse(pubDate)` 성공 시 30일 필터, 실패/빈값 포함) →
    `FieldCandidate{...it, field: feed.label, fieldPriority: feed.priority, category: feed.category, source: feed.source}`.
    개별 피드 try/catch 무시. 전체 `TOTAL_MAX` 절단. (※ `it.source` 를 feed.source 로 덮어써 출처 보정.)
  - **`collectTermCandidates(term)`** 재정의: `const all = await collectFeedCandidates(); const t = term.toLowerCase();
    return all.filter((c) => c.title.toLowerCase().includes(t) || c.contentText.toLowerCase().includes(t));` (구글뉴스 제거).
  - **`enrichSummary(item, cfg)`**:
```ts
const MIN_TEXT = 120;
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
```
  - **`runNewsRadar`**: `RadarRunConfig` 에 `jinaKey?: string` 추가. `collectFieldCandidates()` → `collectFeedCandidates()`.
    ranked 적재 직전, 병렬 enrich + 18s deadline:
```ts
const enrichedList = await Promise.race([
  Promise.all(scored.ranked.map((c) => enrichSummary(c, { apiKey: cfg.apiKey, model: cfg.model, jinaKey: cfg.jinaKey }))),
  new Promise<null>((r) => setTimeout(() => r(null), 18000)),
]);
const finals = scored.ranked.map((c, i) => {
  const e = enrichedList?.[i];
  return e ? { ...c, title_ko: e.title_ko, summary_ko: e.summary_ko } : c;
});
```
    이후 insert 루프에서 `c` 대신 `finals` 사용.
  - **Cleanup(orphan) — 동반 테스트/import 수정 필수:** `grep -rn "googleNewsRssUrl\|RADAR_QUERIES\|buildRadarPrompt\|collectFieldCandidates" lib/ app/ netlify/` 후:
    - `lib/news-radar.ts`: `googleNewsRssUrl`·`RADAR_QUERIES`·`buildRadarPrompt` 제거.
    - **`lib/news-radar.test.ts`: 이들을 import·assert 하는 describe 블록 삭제**(현재 약 2행 import, 4-15·51-60·62-85행대
      `googleNewsRssUrl`/`buildRadarPrompt`/`RADAR_QUERIES` 테스트) — 안 하면 import 깨져 전체 테스트 컴파일 실패.
    - `lib/news-radar-strategy.ts`: `RADAR_FIELDS[].queries` 필드 제거(RADAR_FIELDS·`activeRadarFields` 자체는 유지 —
      `buildScoringPrompt` 는 queries 미참조 확인됨, field/title/source/link/pubDate 만 사용 → 제거 안전).
    - **`lib/news-radar-strategy.test.ts`: `f.queries.length > 0` 단언(약 47-54행) 제거/대체**(queries 삭제로 깨짐).
    - 제거 전 grep, 제거 후 `npx vitest run lib/ && npx tsc --noEmit` 0 에러 확인.
- [ ] **Step 4: 통과** `npx vitest run lib/news-radar-run.test.ts` → PASS.
- [ ] **Step 5: 라우트/스케줄러 jinaKey 전달**
  - `app/api/admin/news-radar-run/route.ts`: `runNewsRadar({..., jinaKey: process.env.JINA_API_KEY })`.
  - `netlify/functions/news-radar.mts`: 동일 추가.
  - `app/api/admin/news-radar-search/route.ts`: **[필수 수정]** 현재 빈 term 분기에서 `collectFieldCandidates()`
    를 import·호출(약 4·45행)하는데 Task 6 가 그 함수를 제거함 → import·empty-term 경로가 깨짐. 빈 term 분기를
    **`collectFeedCandidates()`** 로 교체(import 도). term 분기는 `collectTermCandidates(term)` 유지(피드 필터). 점수화 동일.
- [ ] **Step 6: 전체 회귀** `npx vitest run && npx tsc --noEmit` → PASS / 0 errors.
- [ ] **Step 7: Commit** `git add -A && git commit -m "feat: 소식레이더 피드 수집·원문 충실 요약(enrich) + orphan 정리"`

### Task 7: 수동 추가 서버 라우트 + 컴포넌트
**Files:** Create `app/api/admin/news-radar-add/route.ts`, Modify `components/NewsRadarAdminFeed.tsx`

- [ ] **Step 1: 라우트 구현** (run 라우트 인증 패턴 복사)
  - 관리자 인증(bearer→getUser→profiles.is_admin) 동일.
  - body: `{ title_ko, summary_ko, source_name, source_url, original_title, topic, category, contentText }`.
  - **중복 선검사**(낭비 방지): `news_radar_insert_draft` 가 중복 시 null 반환하므로, 우선 enrich 비용을 줄이려면
    enrich 후 RPC 호출로도 무방(주1·수동이라 소량). 단순화: enrich → RPC. (중복이면 RPC 가 null → "중복" 반환.)
  - `enrichSummary({ title_ko, summary_ko, source_url, original_title, field: topic, contentText }, { apiKey: OPENAI_API_KEY, model, jinaKey: JINA_API_KEY })`.
  - `sb.rpc("news_radar_insert_draft", { p_title_ko: e.title_ko, p_summary_ko: e.summary_ko, p_source_name, p_source_url, p_original_title, p_topic, p_category })` (서버 sb = 인증 토큰 클라이언트, is_admin RPC 게이트 통과).
  - 반환 `{ ok, inserted: Boolean(data), reason? }`.
- [ ] **Step 2: 컴포넌트 수정** `NewsRadarAdminFeed.tsx`:
  - **[필수] `Candidate` 타입(약 22-35행)에 `contentText: string;` 추가** — 안 하면 `c.contentText` 참조가
    tsc 에러(Step 3 게이트 실패)이고 RSS 텍스트가 서버 enrich 로 전달 안 됨. (search 라우트는 이미 `scored.ranked`
    =ScoredCandidate 를 반환하고 Task 5 로 contentText 가 실리므로 런타임엔 도착 — 타입만 맞추면 됨.)
  - `addDraft`: 클라 직접 RPC 제거 → `fetch("/api/admin/news-radar-add", { method:"POST", headers:{ Authorization:
    \`Bearer ${token}\`, "Content-Type":"application/json" }, body: JSON.stringify({ ...c }) })`(c 에 contentText 포함).
  - 세션 토큰 취득: **기존 run/search 호출부 패턴 재사용**(약 114-115행 — 이미 admin 토큰으로 fetch 하는 코드 확인).
  - 응답 `inserted` 로 "추가/중복" 메시지 분기(기존 UX 유지), 목록 갱신.
- [ ] **Step 3: 타입체크·빌드** `npx tsc --noEmit && npm run build` → 0 errors / 성공.
- [ ] **Step 4: 수동 검증** 관리자에서 검색→대기 추가 시 한 문단 요약 생성·출처 표기 확인(개발 서버 또는 배포 프리뷰).
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: 소식레이더 수동 추가 서버 라우트(강화 요약 통일)"`

---

## 완료 기준 (Evidence-Based)
- [ ] `npx vitest run` 전체 PASS(feeds/parseRss/summary/fetch/strategy/run 신규 + 기존 회귀)
- [ ] `npx tsc --noEmit` 0 errors · `npm run build` 성공
- [ ] orphan grep 0 잔여 참조(제거분)
- [ ] 수동검증: 실제 피드 1건이 한 문단 한글 요약 + 출처(매체명) + 원문 링크로 표시
- [ ] PR: spec/plan 링크. **SQL 없음**. env `JINA_API_KEY`(옵션) 안내.

## 미적용/후속
- 낙농 특화 피드 추가(레지스트리 URL 추가).
- `JINA_API_KEY` 미설정 시 무인증 r.jina.ai(주1회라 충분, 실패 시 RSS 텍스트로 충분히 동작).
