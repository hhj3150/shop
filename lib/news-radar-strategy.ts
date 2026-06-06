// 소식 레이더 — 8분야 병렬 검색 전략 + 5기준 100점 점수화(순수 함수, 테스트 대상).
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
