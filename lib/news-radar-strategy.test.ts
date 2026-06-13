import { describe, it, expect } from "vitest";
import {
  CRITERIA_KEYS,
  scoreCandidate,
  rankCandidates,
  buildScoringPrompt,
  parseScoredArray,
  mergeScored,
} from "./news-radar-strategy";
import type { ScoredCandidate } from "./news-radar-strategy";

function makeScored(over: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    field: "A2 우유",
    fieldPriority: 1,
    category: "human",
    scores: { recency: 0, interest: 0, relevance: 0, conversion: 0, storytelling: 0 },
    reason: "",
    exclude: false,
    title_ko: "제목",
    summary_ko: "요약",
    source_name: "출처",
    source_url: "https://x/1",
    contentText: "",
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
    expect(scoreCandidate(c)).toBe(70);
  });

  it("각 기준은 0~20으로 클램프된다", () => {
    const c = makeScored({ scores: { recency: 99, interest: -5, relevance: 0, conversion: 0, storytelling: 0 } });
    expect(scoreCandidate(c)).toBe(20);
  });
});

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

describe("buildScoringPrompt", () => {
  const cands = [
    { field: "A2 우유", fieldPriority: 1, title: "A2 milk study", link: "https://x/1", source: "DairyNews", pubDate: "d", contentText: "" },
  ];

  it("5기준·제외규칙·JSON 배열 지시·후보 제목을 포함한다", () => {
    const p = buildScoringPrompt(cands);
    expect(p).toContain("A2 milk study");
    expect(p).toContain("recency");
    expect(p).toContain("storytelling");
    expect(p).toContain("conversion");
    expect(p).toContain("title_ko");
    expect(p).toContain("exclude");
    expect(p).toContain("20");
    expect(p).toContain("광고");
    expect(p).toMatch(/JSON 배열/);
    expect(p).toContain('"index"');
  });

  it("검색어가 있으면 프롬프트에 반영한다", () => {
    const p = buildScoringPrompt(cands, { searchTerm: "오메가3 우유" });
    expect(p).toContain("오메가3 우유");
  });
});

describe("parseScoredArray", () => {
  it("텍스트에 박힌 JSON 배열을 파싱한다", () => {
    const out = parseScoredArray('설명\n[{"index":0}]\n끝');
    expect(out).toEqual([{ index: 0 }]);
  });
  it("배열이 없거나 깨지면 빈 배열", () => {
    expect(parseScoredArray("no json")).toEqual([]);
    expect(parseScoredArray("[broken")).toEqual([]);
  });
  it("앞에 대괄호가 포함된 설명이 있어도 실제 배열을 파싱한다", () => {
    const out = parseScoredArray('[기준] 점수표\n[{"index":1,"reason":"r"}]');
    expect(out).toEqual([{ index: 1, reason: "r" }]);
  });
});

describe("mergeScored", () => {
  const candidates = [
    { field: "A2 우유", fieldPriority: 1, title: "A2 study", link: "https://x/a2", source: "S", pubDate: "d", contentText: "" },
    { field: "저지 우유", fieldPriority: 2, title: "Jersey news", link: "https://x/jersey", source: "S2", pubDate: "d", contentText: "" },
  ];

  it("index 로 원후보의 url·분야·우선순위·원제목을 붙인다", () => {
    const raw = [
      { index: 0, scores: { recency: 18, interest: 0, relevance: 0, conversion: 0, storytelling: 0 }, reason: "r", exclude: false, title_ko: "에이투", summary_ko: "요약", source_name: "S" },
    ];
    const out = mergeScored(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].source_url).toBe("https://x/a2");
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

  it("문자열 index 도 숫자로 해석한다", () => {
    const raw = [{ index: "1", title_ko: "저지" }];
    const out = mergeScored(raw, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].source_url).toBe("https://x/jersey");
    expect(out[0].title_ko).toBe("저지");
  });

  it("분야 후보의 category 는 원후보에서, 모델 category 보다 우선한다", () => {
    const petCands = [
      { field: "반려동물 건강·휴먼그레이드", fieldPriority: 8, title: "pet", link: "https://x/pet", source: "S", pubDate: "d", category: "pet" as const, contentText: "" },
    ];
    const out = mergeScored([{ index: 0, category: "human" }], petCands);
    expect(out[0].category).toBe("pet");
  });

  it("검색 후보(category 없음)는 모델 분류를 따른다", () => {
    const out = mergeScored([{ index: 0, category: "pet" }], candidates);
    expect(out[0].category).toBe("pet");
  });

  it("category 정보가 전혀 없으면 'human' 으로 기본 설정", () => {
    const out = mergeScored([{ index: 0 }], candidates);
    expect(out[0].category).toBe("human");
  });
});

describe("buildScoringPrompt — 효능·category 규칙", () => {
  const cands = [
    { field: "A2 우유", fieldPriority: 1, title: "A2 milk study", link: "https://x/1", source: "S", pubDate: "d", contentText: "" },
  ];
  it("질병 예방·치료 효능 단정 콘텐츠 제외 규칙을 포함한다", () => {
    const p = buildScoringPrompt(cands);
    expect(p).toContain("효능");
    expect(p).toMatch(/예방.?치료/);
  });
  it("category 분류(pet/human)를 출력 스키마에 포함한다", () => {
    const p = buildScoringPrompt(cands);
    expect(p).toContain("category");
    expect(p).toContain("pet");
  });
});

describe("mergeScored contentText·source", () => {
  const cand = [{ title: "T", link: "https://p/a", source: "Phys.org", pubDate: "", contentText: "BODY", field: "농업", fieldPriority: 2, category: "human" as const }];
  it("contentText 보존 + source 는 피드값 우선", () => {
    const raw = [{ index: 0, title_ko: "ㄱ", summary_ko: "ㄴ", source_name: "모델추정", scores: {} }];
    const m = mergeScored(raw, cand);
    expect(m[0].contentText).toBe("BODY");
    expect(m[0].source_name).toBe("Phys.org");
  });
  it("피드 source 가 비면 모델 추정으로 폴백", () => {
    const c2 = [{ title: "T", link: "https://p/a", source: "", pubDate: "", contentText: "B", field: "농업", fieldPriority: 2, category: "human" as const }];
    const raw = [{ index: 0, title_ko: "ㄱ", summary_ko: "ㄴ", source_name: "모델추정", scores: {} }];
    expect(mergeScored(raw, c2)[0].source_name).toBe("모델추정");
  });
});
