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
