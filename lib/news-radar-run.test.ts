import { describe, it, expect, vi } from "vitest";
import { enrichSummary } from "./news-radar-run";

describe("enrichSummary", () => {
  const base = { title_ko: "원제목", summary_ko: "원요약", source_url: "https://p/a", original_title: "OT", field: "농업", contentText: "" };
  const okOpenAI = (json: string) =>
    vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: json } }] }), { status: 200 }));

  it("contentText 충분 → Jina 미호출, 요약 교체", async () => {
    const f = okOpenAI('{"title_ko":"새제목","summary_ko":"새요약"}');
    const out = await enrichSummary({ ...base, contentText: "x".repeat(300) }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "새제목", summary_ko: "새요약" });
    expect(f.mock.calls.every((c) => !String(c[0]).includes("r.jina.ai"))).toBe(true);
  });
  it("요약 파싱 실패 → 입력 폴백", async () => {
    const f = okOpenAI("noop");
    const out = await enrichSummary({ ...base, contentText: "x".repeat(300) }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "원제목", summary_ko: "원요약" });
  });
  it("contentText 빈약 + Jina 실패 → 입력 폴백", async () => {
    const f = vi.fn<typeof fetch>(async (u) => String(u).includes("r.jina.ai") ? new Response("", { status: 500 }) : new Response("{}", { status: 200 }));
    const out = await enrichSummary({ ...base, contentText: "" }, { apiKey: "K", model: "m", fetchImpl: f as unknown as typeof fetch });
    expect(out).toEqual({ title_ko: "원제목", summary_ko: "원요약" });
  });
});
