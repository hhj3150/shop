import { describe, it, expect } from "vitest";
import {
  RADAR_FIELDS,
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
    { field: "A2 우유", fieldPriority: 1, title: "A2 study", link: "https://x/a2", source: "S", pubDate: "d" },
    { field: "저지 우유", fieldPriority: 2, title: "Jersey news", link: "https://x/jersey", source: "S2", pubDate: "d" },
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
});
