// 소식 레이더 — 8분야 병렬 검색 전략 + 5기준 100점 점수화(순수 함수, 테스트 대상).
//   외부 호출(RSS·OpenAI)은 run/route 에서. 쿼리맵·프롬프트·파싱·정렬은 여기서.
import type { RssItem } from "./news-radar";

export type RadarCategory = "human" | "pet";

export type RadarField = {
  key: string; // 안정적 영문 키
  label: string; // 한글 분야 라벨(= topic 으로 저장)
  priority: number; // 1(최우선)~8
  category: RadarCategory; // 사람 유제품 vs 반려동물(펫 게이트)
};

// 우선순위(스펙 1~8). 분야 라벨·우선순위·펫 게이트 메타.
//   ⑧ 펫 분야는 category='pet' — PET_CONTENT_ENABLED 플래그로 자동 수집·공개를 게이트.
export const RADAR_FIELDS: RadarField[] = [
  { key: "a2-milk", label: "A2 우유", priority: 1, category: "human" },
  { key: "jersey-milk", label: "저지 우유", priority: 2, category: "human" },
  { key: "hay-milk", label: "헤이밀크", priority: 3, category: "human" },
  { key: "yogurt-fermentation", label: "요거트·발효", priority: 4, category: "human" },
  { key: "gut-microbiome", label: "장건강·마이크로바이옴", priority: 5, category: "human" },
  { key: "animal-welfare-sustainability", label: "동물복지·지속가능", priority: 6, category: "human" },
  { key: "premium-food-trends", label: "프리미엄 식품 트렌드", priority: 7, category: "human" },
  { key: "pet-health-human-grade", label: "반려동물 건강·휴먼그레이드", priority: 8, category: "pet" },
];

// 펫 게이트: 플래그 off 면 펫 분야(category='pet')를 제외한 사람 유제품 분야만 반환.
export function activeRadarFields(petEnabled: boolean): RadarField[] {
  return petEnabled ? RADAR_FIELDS : RADAR_FIELDS.filter((f) => f.category !== "pet");
}

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

// RSS 원후보 + 분야 메타(수집 단계에서 부여). category 는 8분야 수집 시 분야에서, 자유검색은 미정(모델 분류).
export type FieldCandidate = RssItem & {
  field: string;
  fieldPriority: number;
  category?: RadarCategory;
};

// OpenAI 점수화 결과(원후보와 병합 완료).
export type ScoredCandidate = {
  field: string; // 분야 라벨(한글) = topic
  fieldPriority: number; // 1~8 (동점 tiebreak)
  category: RadarCategory; // 'human' | 'pet' (펫 게이트용)
  scores: CriteriaScores;
  reason: string; // 한글 선정 사유
  exclude: boolean; // 광고·PR·협찬·효능 단정 → true
  title_ko: string;
  summary_ko: string;
  source_name: string;
  source_url: string;
  contentText: string;
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
    "제외(exclude=true): 광고성 기사·보도자료(PR)·협찬 콘텐츠.",
    "제외(exclude=true): 제품과 결부해 특정 질병의 예방·치료 효능을 단정하는 콘텐츠(식품표시광고법 위반 소지).",
    "우선 출처: 논문·공공기관·대학·전문 언론.",
    "category: 반려동물(펫) 관련이면 \"pet\", 사람용이면 \"human\" 으로 분류하세요.",
    "reason 에는 점수를 그렇게 준 핵심 근거를 한글 1문장으로 적으세요.",
    "",
    "후보:",
    list,
    "",
    "각 후보를 아래 객체로, 전체를 JSON 배열로만 답하세요(다른 텍스트 금지).",
    '{"index":0,"scores":{"recency":0,"interest":0,"relevance":0,"conversion":0,"storytelling":0},"reason":"한글 사유 1문장","exclude":false,"category":"human","title_ko":"한글 제목","summary_ko":"2~3문장 한글 요약","source_name":"매체명"}',
  ].join("\n");
}

// 텍스트에서 JSON 배열을 찾아 파싱. 앞에 설명·대괄호가 섞여 있어도 각 '[' 위치에서 재시도.
export function parseScoredArray(text: string): Record<string, unknown>[] {
  const end = text.lastIndexOf("]");
  if (end === -1) return [];
  let start = text.indexOf("[");
  while (start !== -1 && start < end) {
    try {
      const v = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    } catch {
      // 다음 '[' 위치에서 재시도
    }
    start = text.indexOf("[", start + 1);
  }
  return [];
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// 모델 출력(raw)을 index 로 원후보와 병합. url·분야·원제목은 원후보에서(환각 방지).
export function mergeScored(
  raw: Record<string, unknown>[],
  candidates: FieldCandidate[]
): ScoredCandidate[] {
  const merged: ScoredCandidate[] = [];
  for (const r of raw) {
    const idx = num(r.index);
    const src = candidates[idx];
    if (!src) continue;
    const s = (r.scores ?? {}) as Record<string, unknown>;
    merged.push({
      field: src.field,
      fieldPriority: src.fieldPriority,
      // 분야 수집 후보는 분야의 category 를 신뢰(우선), 자유검색 후보는 모델 분류를 사용. 둘 다 없으면 'human'.
      category: src.category ?? (str(r.category) === "pet" ? "pet" : "human"),
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
      source_name: src.source || str(r.source_name),
      source_url: src.link,
      contentText: src.contentText,
      original_title: src.title,
    });
  }
  return merged;
}
