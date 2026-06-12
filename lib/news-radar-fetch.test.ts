import { describe, it, expect, vi } from "vitest";
import { fetchArticleText } from "./news-radar-fetch";
const okFetch = (body: string) =>
  vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
describe("fetchArticleText", () => {
  it("r.jina.ai URL 로 요청, 본문 반환", async () => {
    const f = okFetch("article body");
    const t = await fetchArticleText("https://p/a", { fetchImpl: f as unknown as typeof fetch });
    expect(t).toBe("article body");
    expect(f.mock.calls[0][0] as string).toBe("https://r.jina.ai/https://p/a");
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
    expect(await fetchArticleText("https://p/a", { fetchImpl: vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch })).toBeNull();
    expect(await fetchArticleText("https://p/a", { fetchImpl: vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch })).toBeNull();
    expect(await fetchArticleText("https://p/a", { fetchImpl: vi.fn(async () => { throw new Error("net"); }) as unknown as typeof fetch })).toBeNull();
  });
});
