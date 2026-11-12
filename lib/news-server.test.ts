import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 서버 조회는 환경변수가 없거나(로컬·미리보기 빌드) DB 가 실패해도 throw 하지 않는다 —
//   /story·소식 페이지·RSS·사이트맵이 통째로 깨지지 않게.
describe("news-server — 환경변수 없음", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("목록은 [], 한 건은 null, 사이트맵은 []", async () => {
    const m = await import("./news-server");
    await expect(m.fetchPublishedNews()).resolves.toEqual([]);
    await expect(m.fetchNewsById("0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b")).resolves.toBeNull();
    await expect(m.listNewsForSitemap()).resolves.toEqual([]);
  });

  it("uuid 가 아닌 id 는 DB 에 묻지 않고 null", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const m = await import("./news-server");
    await expect(m.fetchNewsById("../../admin")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("DB 오류면 throw 하지 않고 빈 결과", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    // 400 + PostgREST 오류 본문(supabase-js 는 네트워크 오류·일부 5xx 를 재시도하므로 즉시 끝나는 400 으로 본다).
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ code: "22P02", message: "boom", details: null, hint: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await import("./news-server");
    await expect(m.fetchPublishedNews()).resolves.toEqual([]);
    await expect(m.fetchNewsById("0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b")).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    fetchSpy.mockRestore();
    err.mockRestore();
  });
});

// 소식 띠(/story)의 고유 주소 링크가 '펼쳤을 때만' 그려지면 검색 로봇이 발견하지 못한다(로봇은 누르지 않는다).
describe("NewsBand — 고유 주소 링크가 접힌 상태에서도 HTML 에 있다", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("서버 컴포넌트가 첫 목록을 넣는다(브라우저 전용 조회가 아니다)", () => {
    const band = read("components/NewsBand.tsx");
    expect(band).not.toMatch(/^\s*["']use client["']/m);
    expect(band).toContain("fetchPublishedNews");
  });

  it("목록 아이템: 패널은 hidden 으로 접고, 링크는 그 안에 항상 있다", () => {
    const list = read("components/NewsBandList.tsx");
    expect(list).toContain("hidden={!open}");
    expect(list).toContain("href={newsPath(row.id)}");
    // 링크가 {open && (...)} 조건부 블록 안으로 들어가면 안 된다.
    const openBlock = list.slice(list.indexOf("{open &&"), list.indexOf(": null)}"));
    expect(openBlock).not.toContain("newsPath");
  });
});
