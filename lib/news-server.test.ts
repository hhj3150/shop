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

  // 재생성(ISR) 중 DB 오류는 던져야 Next 가 마지막 정상본을 유지한다(빈 결과를 캐시하면 '있는 글이 404').
  //   빌드 중에만 빈 결과로 넘겨 배포가 DB 장애에 막히지 않게 한다.
  const mockDbError = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ code: "22P02", message: "boom", details: null, hint: null }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );

  it("DB 오류: 빌드 중에는 빈 결과", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.NEXT_PHASE = "phase-production-build";
    const fetchSpy = mockDbError();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await import("./news-server");
    await expect(m.fetchPublishedNews()).resolves.toEqual([]);
    // 1건 조회는 빌드 중에도 던진다 — 있는 글이 404 로 미리 만들어지면 안 된다(빌드 실패 = 직전 배포 유지).
    await expect(m.fetchNewsById("0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b")).rejects.toThrow();
    await expect(m.fetchLatestNews(4)).resolves.toEqual([]);
    expect(err).toHaveBeenCalled();
    fetchSpy.mockRestore();
    err.mockRestore();
    delete process.env.NEXT_PHASE;
  });

  it("DB 오류: 빌드가 끝난 뒤(재생성)에는 던진다", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.NEXT_PHASE;
    const fetchSpy = mockDbError();
    const m = await import("./news-server");
    await expect(m.fetchPublishedNews()).rejects.toThrow();
    await expect(m.fetchNewsById("0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b")).rejects.toThrow();
    fetchSpy.mockRestore();
  });
});

// 소식 띠(/story)의 고유 주소 링크가 '펼쳤을 때만' 그려지면 검색 로봇이 발견하지 못한다(로봇은 누르지 않는다).
describe("NewsBand — 고유 주소 링크가 접힌 상태에서도 HTML 에 있다", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("서버 컴포넌트가 첫 목록을 넣는다(브라우저 전용 조회가 아니다)", () => {
    const band = read("components/NewsBand.tsx");
    expect(band).not.toMatch(/^\s*["']use client["']/m);
    expect(band).toContain("fetchLatestNews");
  });

  it("목록 아이템: 패널은 hidden 으로 접고, 링크는 그 안에 항상 있다", () => {
    const list = read("components/NewsBandList.tsx");
    expect(list).toContain("hidden={!open}");
    expect(list).toContain("href={newsPath(row.id)}");
    // 링크가 {open && (...)} 조건부 블록 안으로 들어가면 안 된다.
    const from = list.indexOf("{open &&");
    const to = list.indexOf(": null)}");
    // 표지 문자열이 사라지면(리팩터링) 이 검사가 헛돌지 않게 먼저 확인한다.
    expect(from, "NewsBandList 의 펼침 블록 시작 표지를 찾지 못했다").toBeGreaterThanOrEqual(0);
    expect(to, "NewsBandList 의 펼침 블록 끝 표지를 찾지 못했다").toBeGreaterThan(from);
    const openBlock = list.slice(from, to);
    expect(openBlock).not.toContain("newsPath");
  });
});
