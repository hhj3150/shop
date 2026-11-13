// 스마트폰 '이전 화면' 버튼 — 2026-11-14 회장님: "이전으로 가기 버튼이 없어 홈으로 갔다가 다시 목록으로 가야 한다".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { backFallback, canGoBackInSite, recordVisit, shouldResetOnLoad, showBackButton } from "./back-nav";

describe("앞 화면이 없을 때 가는 목록", () => {
  it.each([
    ["/learn/certified-farm", "/learn"],
    ["/learn/a2-milk/", "/learn"],
    ["/learn", "/"],
    ["/story/news/12", "/story#news"],
    ["/story", "/"],
    ["/products/milk-180", "/#products"],
    ["/account/billing", "/account"],
    ["/account", "/"],
    ["/admin/news", "/admin"],
    ["/faq", "/"],
    ["/orders/lookup", "/"],
    ["/checkout", "/"],
  ])("%s → %s", (from, to) => {
    expect(backFallback(from)).toBe(to);
  });
});

describe("버튼 표시", () => {
  it("홈에서는 숨기고 그 밖에서는 보인다", () => {
    expect(showBackButton("/")).toBe(false);
    expect(showBackButton("/learn")).toBe(true);
    expect(showBackButton("/products/milk-180")).toBe(true);
  });
});

describe("사이트 안 기록(스택)", () => {
  it("홈 → 알아보기 → 글: 뒤로 갈 수 있다", () => {
    let s: string[] = [];
    for (const p of ["/", "/learn", "/learn/hay-milk"]) s = recordVisit(s, p);
    expect(s).toEqual(["/", "/learn", "/learn/hay-milk"]);
    expect(canGoBackInSite(s)).toBe(true);
  });
  it("뒤로 가면 맨 위를 뺀다(브라우저·버튼 모두)", () => {
    expect(recordVisit(["/", "/learn", "/learn/hay-milk"], "/learn")).toEqual(["/", "/learn"]);
  });
  it("새로고침(같은 주소)은 그대로", () => {
    expect(recordVisit(["/", "/faq"], "/faq")).toEqual(["/", "/faq"]);
  });
  it("링크로 바로 들어온 첫 화면은 뒤로 갈 곳이 없다 → 목록으로", () => {
    const s = recordVisit([], "/learn/certified-farm");
    expect(canGoBackInSite(s)).toBe(false);
  });
  it("기록은 50개까지만", () => {
    let s: string[] = [];
    for (let i = 0; i < 80; i++) s = recordVisit(s, `/learn/p${i}`);
    expect(s).toHaveLength(50);
  });
});

describe("새로 불러온 페이지 — 기록을 새로 시작할지", () => {
  const origin = "https://shop.a2jerseymilk.com";
  it("검색·카카오톡 등 다른 곳에서 들어오면 새로 시작(뒤로가 사이트 밖으로 나가지 않게)", () => {
    expect(shouldResetOnLoad({ navigationType: "navigate", referrer: "https://search.naver.com/x", origin })).toBe(true);
    expect(shouldResetOnLoad({ navigationType: "navigate", referrer: "", origin })).toBe(true);
    expect(shouldResetOnLoad({ navigationType: "navigate", referrer: "not a url", origin })).toBe(true);
  });
  it("사이트 안에서 온 전체 로드·새로고침·앞뒤 이동은 이어 간다", () => {
    expect(shouldResetOnLoad({ navigationType: "navigate", referrer: `${origin}/learn`, origin })).toBe(false);
    expect(shouldResetOnLoad({ navigationType: "reload", referrer: "", origin })).toBe(false);
    expect(shouldResetOnLoad({ navigationType: "back_forward", referrer: "https://google.com", origin })).toBe(false);
  });
});

describe("상단 바에 붙어 있다", () => {
  const nav = readFileSync(join(__dirname, "..", "components/Nav.tsx"), "utf8");
  const btn = readFileSync(join(__dirname, "..", "components/BackButton.tsx"), "utf8");
  it("Nav 가 BackButton 을 그린다", () => {
    expect(nav).toMatch(/<BackButton \/>/);
  });
  it("스마트폰에서만(md:hidden), 읽어 주는 이름이 있다, 손가락 크기(44px)", () => {
    expect(btn).toMatch(/md:hidden/);
    expect(btn).toMatch(/aria-label="이전 화면으로"/);
    expect(btn).toMatch(/h-11 w-11/);
  });
  it("앞 화면이 없으면 목록으로 '바꿔' 보낸다(replace) — push 면 목록에서 이전을 누를 때 글로 되돌아온다", () => {
    expect(btn).toMatch(/router\.replace\(backFallback\(pathname\)\)/);
    expect(btn).not.toMatch(/router\.push\(/);
  });
});
