# 소식 레이더 — 검색·점수화·선별 게시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 소식 레이더를 "8분야 병렬 검색 → 7기준 점수화 → TOP3 대기 적재"로 확장하고, 관리자 패널에 자유 검색·후보 점수 표시·선택 대기추가를 추가한다(자동 게시 없음, 관리자 승인 유지).

**Architecture:** 순수 로직(8분야 쿼리맵·점수화 프롬프트·JSON 파싱·가중합 정렬·중복제거)을 신설 `lib/news-radar-strategy.ts`에 모아 vitest로 TDD한다. 외부 I/O(RSS fetch·OpenAI 호출)는 기존 `lib/news-radar-run.ts`(주간/수동 공용)와 신설 `app/api/admin/news-radar-search/route.ts`에서 수행하되, 점수·정렬·중복제거는 순수 함수에 위임한다. 관리자 선택 적재는 신규 `news_radar_insert_draft` RPC(is_admin 게이트, published=false)로 처리한다.

**Tech Stack:** Next.js 16 (App Router, route handlers) · React 19 · Supabase JS · OpenAI Chat Completions · Google News RSS · vitest · TypeScript(strict).

---

## 배경 / 기존 코드 (구현 전 반드시 읽기)

- 스펙: `docs/superpowers/specs/2026-06-06-news-radar-search-curation-design.md`
- 순수부: `lib/news-radar.ts` — `RadarQuery`, `RADAR_QUERIES`, `googleNewsRssUrl`(현재 `when:7d` 하드코딩), `parseRss`, `RssItem`, `buildRadarPrompt`(1건 선별). 테스트 `lib/news-radar.test.ts`.
- 실행부: `lib/news-radar-run.ts` — `collectCandidates`(15개 상한), `extractJson`, `runNewsRadar(cfg)`(1건 선별 → `news_radar_insert` secret RPC). 반환 타입 `RadarRunResult`/`RadarRunConfig`.
- 수동 실행: `app/api/admin/news-radar-run/route.ts`(is_admin 게이트 패턴 — 그대로 차용).
- 주간 스케줄: `netlify/functions/news-radar.mts`(`runNewsRadar` 호출 — 시그니처 유지 시 무수정).
- 관리자 UI: `components/NewsRadarAdminFeed.tsx` — 목록 로드 + 게시/숨김(`news_radar_set_published`) + 삭제(`news_radar_delete`) + 즉시수집(`/api/admin/news-radar-run`).
- DB: `supabase/migration-news-radar.sql`(테이블 + `news_radar_insert` secret RPC), `supabase/migration-news-radar-moderation.sql`(`published` 컬럼 + `is_admin()` 정책 + set_published/delete). `news_radar.source_url`은 UNIQUE.
- 관리자 함수: `public.is_admin()` = `profiles.is_admin`(security definer). 이미 존재.
- 경로 별칭: `@/*` → `./*`. 테스트: `npm test`(=`vitest run`). 타입체크: `npx tsc --noEmit`.
- 환경변수(서버, 커밋 금지): `OPENAI_API_KEY`, `OPENAI_MODEL`(기본 `gpt-5.4-mini`), `NEWS_RADAR_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## File Structure

- **Create** `lib/news-radar-strategy.ts` — 8분야 쿼리맵(`RADAR_FIELDS`), 7기준 가중치(`CRITERIA_WEIGHTS`), 점수화 프롬프트(`buildScoringPrompt`), 응답 파싱(`parseScoredArray`)·병합(`mergeScored`), 가중합 점수(`scoreCandidate`)·정렬/중복제거/상위N(`rankCandidates`). 타입: `RadarField`, `CriteriaScores`, `FieldCandidate`, `ScoredCandidate`. (순수 — TDD)
- **Create** `lib/news-radar-strategy.test.ts` — 위 순수 로직 vitest.
- **Modify** `lib/news-radar.ts` — `googleNewsRssUrl(query, days = 7)`로 기간 파라미터화(기본 유지). 그 외 무수정.
- **Modify** `lib/news-radar.test.ts` — 30일 URL 케이스 1개 추가.
- **Modify** `lib/news-radar-run.ts` — 8분야 후보 수집 + 점수화 → TOP3 insert(secret RPC, 중복 무시), `RadarRunResult`에 `insertedCount`/`titles` 추가. `scoreCandidatesViaOpenAI` 헬퍼를 export(검색 라우트와 공용).
- **Create** `app/api/admin/news-radar-search/route.ts` — is_admin 게이트 → 후보 수집(term 있으면 단일쿼리, 없으면 8분야) → 점수화 → 상위 후보 배열 반환(insert 안 함).
- **Create** `supabase/migration-news-radar-curation.sql` — `news_radar_insert_draft` RPC(is_admin, published=false, 중복 무시).
- **Modify** `components/NewsRadarAdminFeed.tsx` — 검색창 + 결과 후보 카드(점수·사유) + [대기 추가](`news_radar_insert_draft`). 기존 목록/게시/삭제/즉시수집 유지.

## 점수 모델 (확정 값 — 스펙 100점 루브릭, 구현 시 그대로 사용)

5기준 각 **0~20점**, 합산 **0~100점**(가중치 없음 — 20점 상한이 곧 동일 비중):

| 키 | 의미 | 만점 |
|---|---|---|
| `recency` | 최신성 | 20 |
| `interest` | 검색량·관심도 | 20 |
| `relevance` | 송영신목장(A2·저지·헤이밀크·플레인 요거트) 연관성 | 20 |
| `conversion` | 판매 전환 가능성 | 20 |
| `storytelling` | 스토리텔링 가능성 | 20 |

**총점** `totalScore = recency + interest + relevance + conversion + storytelling`(각 0~20 클램프) → 0~100.
**동점 시** 분야 우선순위(`fieldPriority` 작을수록 우선)로 가름 — 점수에 가중하지 않고 **정렬 2차 키**로만 사용.
기준별 점수 + 선정 사유(`reason`)는 관리자 UI에 노출(투명성). 과학적 근거·프리미엄 가치는 `relevance`/`storytelling` 채점과 출처 우선 규칙에 반영(별도 기준 없음).

---

### Task 1: 8분야 쿼리맵 `RADAR_FIELDS` (순수)

**Files:**
- Create: `lib/news-radar-strategy.ts`
- Test: `lib/news-radar-strategy.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`lib/news-radar-strategy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RADAR_FIELDS } from "./news-radar-strategy";

describe("RADAR_FIELDS", () => {
  it("8개 분야를 우선순위 1~8로 정의한다", () => {
    expect(RADAR_FIELDS).toHaveLength(8);
    const priorities = RADAR_FIELDS.map((f) => f.priority).sort((a, b) => a - b);
    expect(priorities).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("핵심 분야 라벨을 포함한다", () => {
    const labels = RADAR_FIELDS.map((f) => f.label);
    expect(labels).toContain("A2 우유");
    expect(labels).toContain("저지 우유");
    expect(labels).toContain("헤이밀크");
    expect(labels).toContain("요거트·발효");
    expect(labels).toContain("반려동물 건강·휴먼그레이드");
  });

  it("모든 분야는 라벨과 1개 이상 비어있지 않은 영문 쿼리를 가진다", () => {
    for (const f of RADAR_FIELDS) {
      expect(f.label.trim().length).toBeGreaterThan(0);
      expect(f.key.trim().length).toBeGreaterThan(0);
      expect(f.queries.length).toBeGreaterThan(0);
      for (const q of f.queries) expect(q.trim().length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: FAIL — `Cannot find module './news-radar-strategy'`.

- [ ] **Step 3: 최소 구현**

`lib/news-radar-strategy.ts` (파일 상단부):
```ts
// 소식 레이더 — 8분야 병렬 검색 전략 + 7기준 점수화(순수 함수, 테스트 대상).
//   외부 호출(RSS·OpenAI)은 run/route 에서. 쿼리맵·프롬프트·파싱·정렬은 여기서.
import type { RssItem } from "./news-radar";

export type RadarField = {
  key: string; // 안정적 영문 키
  label: string; // 한글 분야 라벨(= topic 으로 저장)
  priority: number; // 1(최우선)~8
  queries: string[]; // 영문 검색 쿼리 세트(우선순위 전략 반영)
};

// 우선순위(스펙 1~8). 쿼리는 우선순위 전략 1~9를 8분야에 분배.
export const RADAR_FIELDS: RadarField[] = [
  {
    key: "a2-milk",
    label: "A2 우유",
    priority: 1,
    queries: [
      '"A2 milk" ("health" OR "research" OR "study" OR "consumer trend")',
      '"A2 beta-casein" ("digestion" OR "protein" OR "study")',
      '"A2 milk" ("market growth" OR "premium")',
    ],
  },
  {
    key: "jersey-milk",
    label: "저지 우유",
    priority: 2,
    queries: [
      '"Jersey milk" ("nutrition" OR "protein" OR "butterfat" OR "calcium")',
      '"Jersey cow" milk ("omega-3" OR "CLA" OR "premium")',
    ],
  },
  {
    key: "hay-milk",
    label: "헤이밀크",
    priority: 3,
    queries: [
      '"hay milk" OR Heumilch ("quality" OR "certification" OR "grass-fed")',
      '"grass-fed" dairy ("pasture" OR "milk quality")',
    ],
  },
  {
    key: "yogurt-fermentation",
    label: "요거트·발효",
    priority: 4,
    queries: [
      '"plain yogurt" ("probiotics" OR "postbiotics" OR "fermentation")',
      '"yogurt" ("gut health" OR "immune" OR "premium")',
    ],
  },
  {
    key: "gut-microbiome",
    label: "장건강·마이크로바이옴",
    priority: 5,
    queries: [
      '"gut microbiome" ("dairy" OR "yogurt" OR "probiotics" OR "immune")',
      'protein ("muscle" OR "sarcopenia" OR "healthy aging") dairy',
    ],
  },
  {
    key: "animal-welfare-sustainability",
    label: "동물복지·지속가능",
    priority: 6,
    queries: [
      'dairy ("animal welfare" OR "pasture-raised")',
      '("low-carbon" OR "regenerative" OR "sustainable") dairy',
    ],
  },
  {
    key: "premium-food-trends",
    label: "프리미엄 식품 트렌드",
    priority: 7,
    queries: [
      '"premium dairy" ("brand" OR "consumer trend" OR "Europe")',
      '"premium yogurt" OR "functional food" ("trend" OR "market")',
    ],
  },
  {
    key: "pet-health-human-grade",
    label: "반려동물 건강·휴먼그레이드",
    priority: 8,
    queries: [
      '("dog gut health" OR "pet probiotics") ("microbiome" OR "immune")',
      '("human grade" OR "farm to bowl") pet food',
      '("pet dairy" OR "A2 pet") ("digestion" OR "premium")',
    ],
  },
];
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts
git commit -m "feat(news-radar): 8분야 병렬 검색 쿼리맵(RADAR_FIELDS) 추가"
```

---

### Task 2: 5기준 100점 합산 점수 `scoreCandidate` (순수)

**Files:**
- Modify: `lib/news-radar-strategy.ts`
- Test: `lib/news-radar-strategy.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`lib/news-radar-strategy.test.ts` 하단에 추가:
```ts
import { CRITERIA_KEYS, scoreCandidate } from "./news-radar-strategy";
import type { ScoredCandidate } from "./news-radar-strategy";

function makeScored(over: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    field: "A2 우유",
    fieldPriority: 1,
    scores: { recency: 0, interest: 0, relevance: 0, conversion: 0, storytelling: 0 },
    reason: "",
    exclude: false,
    title_ko: "제목",
    summary_ko: "요약",
    source_name: "출처",
    source_url: "https://x/1",
    original_title: "orig",
    ...over,
  };
}

describe("CRITERIA_KEYS", () => {
  it("5개 기준 키를 정의한다", () => {
    expect(CRITERIA_KEYS).toEqual(["recency", "interest", "relevance", "conversion", "storytelling"]);
  });
});

describe("scoreCandidate", () => {
  it("5기준 합산(0~100). 분야는 점수에 영향 없음", () => {
    const c = makeScored({
      fieldPriority: 5,
      scores: { recency: 20, interest: 10, relevance: 20, conversion: 15, storytelling: 5 },
    });
    expect(scoreCandidate(c)).toBe(70); // 20+10+20+15+5
  });

  it("각 기준은 0~20으로 클램프된다", () => {
    const c = makeScored({ scores: { recency: 99, interest: -5, relevance: 0, conversion: 0, storytelling: 0 } });
    expect(scoreCandidate(c)).toBe(20); // 20(클램프) + 0
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: FAIL — `CRITERIA_KEYS`/`scoreCandidate`/`ScoredCandidate` 미정의.

- [ ] **Step 3: 최소 구현**

`lib/news-radar-strategy.ts`에 추가:
```ts
// 100점 루브릭 5기준(각 0~20). 가중치 없음 — 합산 0~100. 분야 우선순위는 동점 tiebreak(rankCandidates)에서만.
export type CriteriaScores = {
  recency: number; // 최신성
  interest: number; // 검색량·관심도
  relevance: number; // 송영신목장(A2·저지·헤이밀크·요거트) 연관성
  conversion: number; // 판매 전환 가능성
  storytelling: number; // 스토리텔링 가능성
};

export const CRITERIA_KEYS = [
  "recency",
  "interest",
  "relevance",
  "conversion",
  "storytelling",
] as const satisfies readonly (keyof CriteriaScores)[];

// RSS 원후보 + 분야 메타(수집 단계에서 부여).
export type FieldCandidate = RssItem & { field: string; fieldPriority: number };

// OpenAI 점수화 결과(원후보와 병합 완료).
export type ScoredCandidate = {
  field: string; // 분야 라벨(한글) = topic
  fieldPriority: number; // 1~8 (동점 tiebreak)
  scores: CriteriaScores;
  reason: string; // 한글 선정 사유
  exclude: boolean; // 광고·PR·협찬 → true
  title_ko: string;
  summary_ko: string;
  source_name: string;
  source_url: string;
  original_title: string;
  totalScore?: number; // rankCandidates 가 채움
};

function clamp20(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(20, v));
}

// 5기준 합산(각 0~20 클램프) → 0~100. 분야 우선순위는 점수에 더하지 않는다.
export function scoreCandidate(c: ScoredCandidate): number {
  return CRITERIA_KEYS.reduce((sum, k) => sum + clamp20(c.scores[k]), 0);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts
git commit -m "feat(news-radar): 5기준 100점 합산 점수(scoreCandidate)"
```

---

### Task 3: 정렬·중복제거·상위N `rankCandidates` (순수)

**Files:**
- Modify: `lib/news-radar-strategy.ts`
- Test: `lib/news-radar-strategy.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`lib/news-radar-strategy.test.ts` 하단에 추가:
```ts
import { rankCandidates } from "./news-radar-strategy";

describe("rankCandidates", () => {
  it("총점 내림차순으로 정렬하고 totalScore 를 채운다", () => {
    const lo = makeScored({ source_url: "https://x/lo", scores: { recency: 5, interest: 0, relevance: 0, conversion: 0, storytelling: 0 } });
    const hi = makeScored({ source_url: "https://x/hi", scores: { recency: 20, interest: 0, relevance: 0, conversion: 0, storytelling: 0 } });
    const out = rankCandidates([lo, hi], 10);
    expect(out.map((c) => c.source_url)).toEqual(["https://x/hi", "https://x/lo"]);
    expect(out[0].totalScore).toBe(scoreCandidate(hi));
  });

  it("동점이면 분야 우선순위(번호 작을수록)가 앞선다", () => {
    const same = { scores: { recency: 10, interest: 0, relevance: 0, conversion: 0, storytelling: 0 } };
    const low = makeScored({ ...same, source_url: "https://x/low", fieldPriority: 8 });
    const top = makeScored({ ...same, source_url: "https://x/top", fieldPriority: 1 });
    const out = rankCandidates([low, top], 10);
    expect(out.map((c) => c.source_url)).toEqual(["https://x/top", "https://x/low"]);
  });

  it("exclude=true 후보는 제외한다", () => {
    const keep = makeScored({ source_url: "https://x/keep" });
    const drop = makeScored({ source_url: "https://x/drop", exclude: true });
    const out = rankCandidates([keep, drop], 10);
    expect(out.map((c) => c.source_url)).toEqual(["https://x/keep"]);
  });

  it("같은 source_url 은 1개만(높은 점수 유지)", () => {
    const a = makeScored({ source_url: "https://x/dup", scores: { recency: 20, interest: 0, relevance: 0, conversion: 0, storytelling: 0 } });
    const b = makeScored({ source_url: "https://x/dup", scores: { recency: 5, interest: 0, relevance: 0, conversion: 0, storytelling: 0 } });
    const out = rankCandidates([a, b], 10);
    expect(out).toHaveLength(1);
    expect(out[0].totalScore).toBe(scoreCandidate(a));
  });

  it("source_url 없는 후보는 버린다", () => {
    const out = rankCandidates([makeScored({ source_url: "" })], 10);
    expect(out).toHaveLength(0);
  });

  it("상위 N 개로 자른다", () => {
    const cands = [1, 2, 3, 4].map((i) => makeScored({ source_url: `https://x/${i}` }));
    expect(rankCandidates(cands, 2)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: FAIL — `rankCandidates` 미정의.

- [ ] **Step 3: 최소 구현**

`lib/news-radar-strategy.ts`에 추가:
```ts
// 제외·무url 필터 → 총점 계산 → 점수 내림차순(동점 시 분야 우선순위 오름차순) → source_url 중복제거(높은 점수 유지) → 상위 N.
export function rankCandidates(cands: ScoredCandidate[], topN: number): ScoredCandidate[] {
  const scored = cands
    .filter((c) => !c.exclude && c.source_url.trim().length > 0)
    .map((c) => ({ ...c, totalScore: scoreCandidate(c) }))
    .sort((a, b) => {
      const diff = (b.totalScore ?? 0) - (a.totalScore ?? 0);
      return diff !== 0 ? diff : a.fieldPriority - b.fieldPriority;
    });

  const seen = new Set<string>();
  const deduped: ScoredCandidate[] = [];
  for (const c of scored) {
    if (seen.has(c.source_url)) continue;
    seen.add(c.source_url);
    deduped.push(c);
  }
  return deduped.slice(0, Math.max(0, topN));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts
git commit -m "feat(news-radar): 정렬·중복제거·상위N(rankCandidates)"
```

---

### Task 4: 점수화 프롬프트 `buildScoringPrompt` (순수)

**Files:**
- Modify: `lib/news-radar-strategy.ts`
- Test: `lib/news-radar-strategy.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`lib/news-radar-strategy.test.ts` 하단에 추가:
```ts
import { buildScoringPrompt } from "./news-radar-strategy";

describe("buildScoringPrompt", () => {
  const cands = [
    { field: "A2 우유", fieldPriority: 1, title: "A2 milk study", link: "https://x/1", source: "DairyNews", pubDate: "d" },
  ];

  it("5기준·제외규칙·JSON 배열 지시·후보 제목을 포함한다", () => {
    const p = buildScoringPrompt(cands);
    expect(p).toContain("A2 milk study");
    expect(p).toContain("recency");
    expect(p).toContain("storytelling");
    expect(p).toContain("conversion");
    expect(p).toContain("title_ko");
    expect(p).toContain("exclude");
    expect(p).toContain("20"); // 각 기준 0~20
    expect(p).toContain("광고"); // 제외규칙
    expect(p).toMatch(/JSON 배열/);
    expect(p).toContain('"index"');
  });

  it("검색어가 있으면 프롬프트에 반영한다", () => {
    const p = buildScoringPrompt(cands, { searchTerm: "오메가3 우유" });
    expect(p).toContain("오메가3 우유");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: FAIL — `buildScoringPrompt` 미정의.

- [ ] **Step 3: 최소 구현**

`lib/news-radar-strategy.ts`에 추가:
```ts
export type ScoringPromptOptions = { searchTerm?: string };

// 후보 N개를 5기준 각 0~20으로 채점(합산 100) + 한글 번역 + 제외 플래그를 JSON 배열로 요청.
//   index 로 원후보와 매핑(source_url 환각 방지). 합산·정렬·동점처리는 코드(rankCandidates)에서.
export function buildScoringPrompt(
  candidates: FieldCandidate[],
  opts: ScoringPromptOptions = {}
): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i}. [${c.field}] ${c.title}${c.source ? ` (출처: ${c.source})` : ""}\n   link: ${c.link}\n   date: ${c.pubDate}`
    )
    .join("\n");

  const header = opts.searchTerm
    ? `관리자 검색어: "${opts.searchTerm}". 이 검색어 의도와의 적합성도 함께 고려하세요.`
    : "송영신목장(A2·저지·헤이밀크 우유, 플레인 요거트 판매)의 마케팅 소식으로서의 적합성을 평가하세요.";

  return [
    header,
    "아래 뉴스 후보 각각을 5개 기준에 0~20점으로 채점(합산 100점)하고, 한국어로 번역·요약하세요.",
    "5기준(각 0~20): recency(최신성), interest(검색량·관심도),",
    "  relevance(송영신목장 A2·저지·헤이밀크·플레인 요거트와의 연관성 — 과학적 근거·프리미엄 가치 포함),",
    "  conversion(판매 전환 가능성), storytelling(스토리텔링 가능성).",
    "제외(exclude=true): 광고성 기사·보도자료(PR)·협찬 콘텐츠. 우선 출처: 논문·공공기관·대학·전문 언론.",
    "reason 에는 점수를 그렇게 준 핵심 근거를 한글 1문장으로 적으세요.",
    "",
    "후보:",
    list,
    "",
    "각 후보를 아래 객체로, 전체를 JSON 배열로만 답하세요(다른 텍스트 금지).",
    '{"index":0,"scores":{"recency":0,"interest":0,"relevance":0,"conversion":0,"storytelling":0},"reason":"한글 사유 1문장","exclude":false,"title_ko":"한글 제목","summary_ko":"2~3문장 한글 요약","source_name":"매체명"}',
  ].join("\n");
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts
git commit -m "feat(news-radar): 7기준 점수화 프롬프트(buildScoringPrompt)"
```

---

### Task 5: 응답 파싱·병합 `parseScoredArray` + `mergeScored` (순수)

**Files:**
- Modify: `lib/news-radar-strategy.ts`
- Test: `lib/news-radar-strategy.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`lib/news-radar-strategy.test.ts` 하단에 추가:
```ts
import { parseScoredArray, mergeScored } from "./news-radar-strategy";

describe("parseScoredArray", () => {
  it("텍스트에 박힌 JSON 배열을 파싱한다", () => {
    const out = parseScoredArray('설명\n[{"index":0}]\n끝');
    expect(out).toEqual([{ index: 0 }]);
  });
  it("배열이 없거나 깨지면 빈 배열", () => {
    expect(parseScoredArray("no json")).toEqual([]);
    expect(parseScoredArray("[broken")).toEqual([]);
  });
});

describe("mergeScored", () => {
  const candidates = [
    { field: "A2 우유", fieldPriority: 1, title: "A2 study", link: "https://x/a2", source: "S", pubDate: "d" },
    { field: "저지 우유", fieldPriority: 2, title: "Jersey news", link: "https://x/jersey", source: "S2", pubDate: "d" },
  ];

  it("index 로 원후보의 url·분야·우선순위·원제목을 붙인다", () => {
    const raw = [
      { index: 0, scores: { recency: 18, interest: 0, relevance: 0, conversion: 0, storytelling: 0 }, reason: "r", exclude: false, title_ko: "에이투", summary_ko: "요약", source_name: "S" },
    ];
    const out = mergeScored(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].source_url).toBe("https://x/a2"); // 모델이 아니라 원후보에서
    expect(out[0].field).toBe("A2 우유");
    expect(out[0].fieldPriority).toBe(1);
    expect(out[0].original_title).toBe("A2 study");
    expect(out[0].title_ko).toBe("에이투");
    expect(out[0].scores.recency).toBe(18);
  });

  it("범위 밖 index 는 무시한다", () => {
    const out = mergeScored([{ index: 9 }], candidates);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: FAIL — `parseScoredArray`/`mergeScored` 미정의.

- [ ] **Step 3: 최소 구현**

`lib/news-radar-strategy.ts`에 추가:
```ts
// 텍스트에서 첫 JSON 배열만 추출·파싱. 실패 시 빈 배열.
export function parseScoredArray(text: string): Record<string, unknown>[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]);
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// 모델 출력(raw)을 index 로 원후보와 병합. url·분야·원제목은 원후보에서(환각 방지).
export function mergeScored(
  raw: Record<string, unknown>[],
  candidates: FieldCandidate[]
): ScoredCandidate[] {
  const out: ScoredCandidate[] = [];
  for (const r of raw) {
    const idx = num(r.index);
    const src = candidates[idx];
    if (!src) continue;
    const s = (r.scores ?? {}) as Record<string, unknown>;
    out.push({
      field: src.field,
      fieldPriority: src.fieldPriority,
      scores: {
        recency: num(s.recency),
        interest: num(s.interest),
        relevance: num(s.relevance),
        conversion: num(s.conversion),
        storytelling: num(s.storytelling),
      },
      reason: str(r.reason),
      exclude: r.exclude === true,
      title_ko: str(r.title_ko),
      summary_ko: str(r.summary_ko),
      source_name: str(r.source_name) || src.source,
      source_url: src.link,
      original_title: src.title,
    });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar-strategy.test.ts`
Expected: PASS (전체 strategy 테스트 green).

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar-strategy.ts lib/news-radar-strategy.test.ts
git commit -m "feat(news-radar): 응답 파싱·병합(parseScoredArray·mergeScored)"
```

---

### Task 6: `googleNewsRssUrl` 기간 파라미터화 (30일 지원)

**Files:**
- Modify: `lib/news-radar.ts:21-25`
- Test: `lib/news-radar.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`lib/news-radar.test.ts`의 `describe("googleNewsRssUrl", …)` 안에 추가:
```ts
  it("기간 인자를 주면 when:Nd 로 반영한다", () => {
    expect(googleNewsRssUrl('"A2 milk"', 30)).toContain("when%3A30d");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run lib/news-radar.test.ts`
Expected: FAIL — `when%3A30d` 미포함(현재 7d 고정).

- [ ] **Step 3: 최소 구현**

`lib/news-radar.ts`의 함수 교체(기본값 7 유지 → 기존 테스트 보존):
```ts
// Google News RSS 검색 URL(무료, 키 불필요). 기본 7일, 인자로 기간(일) 조절.
export function googleNewsRssUrl(query: string, days = 7): string {
  const q = encodeURIComponent(`${query} when:${days}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run lib/news-radar.test.ts`
Expected: PASS (기존 7d 케이스 + 신규 30d 케이스).

- [ ] **Step 5: 커밋**

```bash
git add lib/news-radar.ts lib/news-radar.test.ts
git commit -m "feat(news-radar): googleNewsRssUrl 기간 파라미터화(기본 7d 유지)"
```

---

### Task 7: 후보 수집·점수화 헬퍼 + run TOP3 적재

**Files:**
- Modify: `lib/news-radar-run.ts` (전면 개편 — 아래 전체 코드로 교체)

- [ ] **Step 1: 전체 구현**

`lib/news-radar-run.ts` 전체를 아래로 교체:
```ts
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
//   8분야 RSS 검색 → OpenAI 7기준 점수화 → 가중합 정렬 TOP3 → secret RPC 적재(중복 무시, 대기 상태).

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const PER_FIELD_MAX = 3; // 분야당 후보 상한(토큰·비용 관리)
const TOTAL_MAX = 24; // 전체 후보 상한
const TOP_N = 3; // 적재 건수

// 8분야 병렬 검색(분야당 쿼리세트를 순회하며 PER_FIELD_MAX 까지). 최근 30일.
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
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0(`netlify/functions/news-radar.mts`·route 는 `runNewsRadar` 시그니처 동일 → 무수정).

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: 기존 + strategy 테스트 모두 PASS.

- [ ] **Step 4: 커밋**

```bash
git add lib/news-radar-run.ts
git commit -m "feat(news-radar): 8분야 수집·점수화 헬퍼 + run TOP3 대기 적재"
```

---

### Task 8: 관리자 검색 라우트 `/api/admin/news-radar-search`

**Files:**
- Create: `app/api/admin/news-radar-search/route.ts`

- [ ] **Step 1: 구현 작성**

`app/api/admin/news-radar-search/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  collectFieldCandidates,
  collectTermCandidates,
  scoreCandidates,
} from "@/lib/news-radar-run";

// 관리자 검색 — 검색어(옵션) → 후보 점수화 → 상위 후보 반환(insert 안 함). 관리자 인증 필수.
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_MODEL, NEXT_PUBLIC_SUPABASE_*.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) {
    return NextResponse.json({ ok: false, reason: "supabase_env_missing" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });

  const sb = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authUser, error: authErr } = await sb.auth.getUser();
  if (authErr || !authUser?.user) {
    return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  }
  const { data: prof } = await sb.from("profiles").select("is_admin").eq("id", authUser.user.id).single();
  if (!prof?.is_admin) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { term?: unknown };
  const term = typeof body.term === "string" ? body.term.trim() : "";

  const candidates = term ? await collectTermCandidates(term) : await collectFieldCandidates();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, candidates: [] });
  }

  const scored = await scoreCandidates(candidates, {
    apiKey,
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    searchTerm: term || undefined,
    topN: 8,
  });
  if (!scored.ok) {
    return NextResponse.json({ ok: false, reason: scored.reason ?? "scoring_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, candidates: scored.ranked });
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 에러 0.

- [ ] **Step 3: 커밋**

```bash
git add app/api/admin/news-radar-search/route.ts
git commit -m "feat(news-radar): 관리자 검색 라우트(점수화 후보 반환, insert 없음)"
```

---

### Task 9: 관리자 적재 RPC 마이그레이션 `news_radar_insert_draft`

**Files:**
- Create: `supabase/migration-news-radar-curation.sql`

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migration-news-radar-curation.sql`:
```sql
-- 소식 레이더 — 검색·선별: 관리자가 검색 결과 후보를 '대기'로 적재하는 RPC.
--   기존 secret 게이트 insert(news_radar_insert)와 별개. is_admin 게이트, published=false.
--   같은 source_url 은 무시(null 반환).
--
-- 적용: 이 파일 전체를 Supabase SQL Editor 에서 실행.

create or replace function public.news_radar_insert_draft(
  p_title_ko       text,
  p_summary_ko     text,
  p_source_name    text,
  p_source_url     text,
  p_original_title text,
  p_topic          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception '관리자만 가능합니다.'; end if;
  if coalesce(p_title_ko, '') = '' or coalesce(p_source_url, '') = '' then
    raise exception '제목·원문 링크는 필수입니다.';
  end if;
  if exists (select 1 from public.news_radar where source_url = p_source_url) then
    return null; -- 중복 무시
  end if;

  insert into public.news_radar
    (title_ko, summary_ko, source_name, source_url, original_title, topic, published)
  values
    (p_title_ko, coalesce(p_summary_ko, ''), nullif(p_source_name, ''), p_source_url,
     nullif(p_original_title, ''), nullif(p_topic, ''), false)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.news_radar_insert_draft(text, text, text, text, text, text)
  to authenticated;

-- ── 검증(적용 후 확인) ──
--   select proname from pg_proc where proname = 'news_radar_insert_draft';
--   -- 비관리자 세션에서 호출 시 '관리자만 가능합니다.' 예외 확인.
```

- [ ] **Step 2: 커밋(적용은 Task 11에서 사용자 승인 후 수동)**

```bash
git add supabase/migration-news-radar-curation.sql
git commit -m "feat(news-radar): 관리자 적재 RPC 마이그레이션(news_radar_insert_draft)"
```

---

### Task 10: 관리자 UI — 검색창 + 후보 카드 + 대기 추가

**Files:**
- Modify: `components/NewsRadarAdminFeed.tsx`

- [ ] **Step 1: 타입·상태·검색 핸들러 추가**

`components/NewsRadarAdminFeed.tsx`의 `RadarRow` 타입 아래에 추가:
```tsx
type Scores = {
  recency: number; interest: number; relevance: number;
  conversion: number; storytelling: number;
};
type Candidate = {
  field: string;
  fieldPriority: number;
  scores: Scores;
  reason: string;
  exclude: boolean;
  title_ko: string;
  summary_ko: string;
  source_name: string;
  source_url: string;
  original_title: string;
  totalScore?: number;
};
```

같은 컴포넌트 함수의 `useState` 묶음에 추가:
```tsx
  const [term, setTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [addingUrl, setAddingUrl] = useState<string | null>(null);
```

`runNow` 함수 바로 위에 검색·적재 핸들러 추가:
```tsx
  async function search() {
    if (searching) return;
    setSearching(true);
    setRunMsg(null);
    setCandidates([]);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setRunMsg("로그인이 필요합니다.");
        return;
      }
      const res = await fetch("/api/admin/news-radar-search", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ term: term.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; candidates?: Candidate[]; reason?: string }
        | null;
      if (!json?.ok) {
        setRunMsg(
          json?.reason === "not_configured"
            ? "환경변수 미설정(OPENAI_API_KEY 확인)"
            : `검색 실패: ${json?.reason ?? "알 수 없음"}`
        );
        return;
      }
      setCandidates(json.candidates ?? []);
      if ((json.candidates ?? []).length === 0) setRunMsg("후보를 찾지 못했습니다.");
    } catch {
      setRunMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  }

  // 선택 후보를 '대기'로 적재(관리자 RPC). 성공 시 후보 목록에서 제거하고 본문 목록 새로고침.
  async function addDraft(c: Candidate) {
    if (addingUrl) return;
    setAddingUrl(c.source_url);
    setRunMsg(null);
    try {
      const { data, error } = await getSupabase().rpc("news_radar_insert_draft", {
        p_title_ko: c.title_ko,
        p_summary_ko: c.summary_ko,
        p_source_name: c.source_name,
        p_source_url: c.source_url,
        p_original_title: c.original_title,
        p_topic: c.field,
      });
      if (error) {
        setRunMsg(`대기 추가 실패: ${error.message}`);
        return;
      }
      setCandidates((prev) => prev.filter((x) => x.source_url !== c.source_url));
      setRunMsg(data ? "대기 목록에 추가했습니다." : "이미 수집된 소식입니다(중복).");
      await load();
    } catch {
      setRunMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setAddingUrl(null);
    }
  }
```

- [ ] **Step 2: 검색 UI + 후보 카드 렌더 추가**

`components/NewsRadarAdminFeed.tsx`의 본문 `<div className="p-5">` 안, `{runMsg && (...)}` 블록 **바로 아래**에 추가:
```tsx
      {/* 관리자 검색 — 자유 검색어(빈칸이면 8분야 전략 자동) → 후보 점수화 */}
      <div className="mt-3 rounded-xl border border-line bg-cream/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="검색어(비우면 8분야 자동 검색)"
            className="min-w-[180px] flex-1 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
          />
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="rounded-full bg-gold-deep px-4 py-1.5 text-[13px] font-semibold text-cream shadow-sm transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60 no-print"
          >
            {searching ? "검색 중…" : "🔎 검색"}
          </button>
        </div>

        {candidates.length > 0 && (
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li key={c.source_url} className="rounded-lg border border-line bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[12px] font-semibold text-gold-deep tabular-nums">
                    점수 {Math.round(c.totalScore ?? 0)}/100
                  </span>
                  <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[12px] text-gold-deep">{c.field}</span>
                </div>
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-[14px] font-medium text-ink transition-colors hover:text-gold-deep"
                >
                  {c.title_ko} <span className="text-[12px] text-mute">↗</span>
                </a>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{c.summary_ko}</p>
                {/* 기준별 점수(투명성) */}
                <p className="mt-1 text-[11.5px] text-mute tabular-nums">
                  최신성 {c.scores.recency} · 관심도 {c.scores.interest} · 연관성 {c.scores.relevance} · 전환 {c.scores.conversion} · 스토리 {c.scores.storytelling}
                </p>
                {c.reason && <p className="mt-1 text-[12px] text-mute">선정 사유: {c.reason}</p>}
                {c.source_name && <p className="mt-0.5 text-[12px] text-mute">{c.source_name}</p>}
                <div className="mt-2 no-print">
                  <button
                    type="button"
                    onClick={() => addDraft(c)}
                    disabled={addingUrl === c.source_url}
                    className="rounded-full bg-hey-green px-3 py-1 text-[12.5px] font-semibold text-cream transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
                  >
                    {addingUrl === c.source_url ? "추가 중…" : "대기 추가"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 3: 즉시수집 메시지 다건 대응(`runNow`)**

`components/NewsRadarAdminFeed.tsx`의 `runNow` 내부, 상태 분기에서 `inserted` 처리만 교체:
```tsx
      } else if (json.status === "inserted") {
        setRunMsg(`새 소식 ${json.insertedCount ?? 1}건 수집 완료`);
        await load();
```
(같은 핸들러의 응답 타입에 `insertedCount`를 반영:)
```tsx
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; status?: string; insertedCount?: number; titles?: string[]; reason?: string }
        | null;
```

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npx tsc --noEmit`
Expected: 에러 0.

Run: `npm run build`
Expected: 빌드 성공(0 errors).

- [ ] **Step 5: 커밋**

```bash
git add components/NewsRadarAdminFeed.tsx
git commit -m "feat(news-radar): 관리자 검색창·후보 카드(점수·사유)·대기 추가 UI"
```

---

### Task 11: 마이그레이션 수동 적용 + 최종 검증 (사용자 승인 게이트)

**Files:** 없음(운영 작업)

- [ ] **Step 1: 전체 테스트 green 확인**

Run: `npm test`
Expected: 모든 테스트 PASS(실패 0). 출력의 통과 개수를 기록.

- [ ] **Step 2: 타입체크 green 확인**

Run: `npx tsc --noEmit`
Expected: 에러 0.

- [ ] **Step 3: 사용자에게 마이그레이션 적용 안내**

사용자에게 다음을 요청(직접 수행):
- Supabase SQL Editor 에서 `supabase/migration-news-radar-curation.sql` 전체 실행.
- 검증 쿼리: `select proname from pg_proc where proname = 'news_radar_insert_draft';` → 1행.

- [ ] **Step 4: 관리자 화면 수동 확인(배포 후)**

- 관리자 로그인 → 소식 레이더 패널.
- 검색어 입력 후 [검색] → 후보 카드(점수·사유) 노출.
- [대기 추가] → "대기 목록에 추가했습니다" + 본문 목록에 ⚪대기 항목 추가.
- [지금 한 번 수집] → "새 소식 N건 수집 완료" 또는 중복/무관 메시지.
- 게시/숨김/삭제 기존 동작 유지.

- [ ] **Step 5: 커밋 전 사용자 승인 후 배포**

```bash
git push origin main   # Netlify 자동 배포
```

---

## Self-Review

**1. Spec coverage**
- 8분야 병렬 검색 → Task 1(쿼리맵) + Task 7(`collectFieldCandidates`). ✔
- 5기준 100점 합산 정렬 TOP3 → Task 2·3·4·5 + Task 7. ✔
- 동점 시 분야 우선순위 tiebreak + 기준별 점수·사유 관리자 노출 → Task 3(`rankCandidates`) + Task 10(카드 점수 표시). ✔
- 제외(광고·PR·협찬)·우선출처 → Task 4 프롬프트 + Task 3 exclude 필터. ✔
- run TOP3 insert·중복무시·주간/수동 공용 → Task 7(`runNewsRadar`, 시그니처 유지로 netlify/route 무수정). ✔
- 관리자 검색창 라우트(insert 안 함) → Task 8. ✔
- 검색 UI·후보카드(점수·사유)·대기추가 → Task 10. ✔
- `news_radar_insert_draft`(is_admin, published=false) 신규 마이그레이션 → Task 9. ✔
- vitest TDD(쿼리맵·정렬·중복제거·JSON파싱) + tsc/vitest green → Task 1~7, 11. ✔
- 커밋 전 사용자 승인·PUBLIC repo 시크릿 금지(env 재사용) → Task 11, 신규 시크릿 없음. ✔

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드·정확한 경로·실행 명령·기대 출력 포함. 플레이스홀더 없음.

**3. Type consistency:** `ScoredCandidate`/`FieldCandidate`/`CriteriaScores` 정의(Task 2)와 사용(Task 3·5·7), `scoreCandidates`/`collectFieldCandidates`/`collectTermCandidates` 시그니처(Task 7)와 호출(Task 8), 프런트 `Candidate` 타입(Task 10)이 라우트 응답(`scored.ranked`)과 필드 일치. `runNewsRadar` 시그니처 유지로 기존 호출부 무수정.

## 비용·안전 메모
- OpenAI 호출: run 1회(≤24후보), 검색 1회(≤8후보). 모델 기본 `gpt-5.4-mini`. PER_FIELD_MAX/TOTAL_MAX/TOP_N 상수로 상한.
- 신규 시크릿 없음 — 기존 `OPENAI_API_KEY`·`NEWS_RADAR_SECRET` 재사용. PUBLIC repo 커밋 금지 유지.
- 자동 게시 없음 — run/draft 모두 `published=false`(대기). 관리자 승인 후 노출.
