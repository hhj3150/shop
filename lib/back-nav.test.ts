// 스마트폰 '이전 화면' 버튼 — 2026-11-14 회장님: "이전으로 가기 버튼이 없어 홈으로 갔다가 다시 목록으로 가야 한다".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backFallback,
  canGoBackInSite,
  classifyVisit,
  nextStack,
  pickBackDelta,
  shouldResetOnLoad,
  showBackButton,
  type VisitKind,
} from "./back-nav";

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

describe("1순위 — 브라우저의 실제 같은 사이트 기록(Navigation API)", () => {
  const u = (p: string) => ({ url: `https://shop.a2jerseymilk.com${p}` });
  it("바로 앞 화면으로 한 칸", () => {
    expect(pickBackDelta([u("/"), u("/learn"), u("/learn/hay-milk")], 2)).toBe(-1);
  });
  it("같은 주소의 #앵커 기록은 건너뛴다(스크롤만 되돌아가지 않게)", () => {
    expect(pickBackDelta([u("/learn"), u("/products/milk-180"), u("/products/milk-180#config")], 2)).toBe(-2);
  });
  it("앞이 다른 사이트(목록에 없음)·첫 화면이면 null → 목록으로", () => {
    expect(pickBackDelta([u("/learn/certified-farm")], 0)).toBeNull();
    expect(pickBackDelta([u("/products/milk-180"), u("/products/milk-180#a")], 1)).toBeNull();
  });
  it("알 수 없는 기록(url 없음)을 만나면 무리하지 않는다", () => {
    expect(pickBackDelta([{ url: null }, u("/faq")], 1)).toBeNull();
  });
  it("로그인 가드(replace) 뒤에도 정확하다 — 제품 → 바로 구매 → /login 에서 이전은 제품, 거기서 이전은 목록", () => {
    // replace 는 기록을 늘리지 않으므로 entries 는 [제품, /login]
    expect(pickBackDelta([u("/products/milk-750"), u("/login?next=/checkout")], 1)).toBe(-1);
    expect(pickBackDelta([u("/products/milk-750"), u("/login?next=/checkout")], 0)).toBeNull();
  });
});

describe("2순위 — 이 탭의 주소 기록(Navigation API 없는 브라우저)", () => {
  const run = (steps: [string, VisitKind][]) => steps.reduce<string[]>((s, [p, k]) => nextStack(s, p, k), []);
  it("홈 → 알아보기 → 글: 뒤로 갈 수 있다", () => {
    const s = run([["/", "push"], ["/learn", "push"], ["/learn/hay-milk", "push"]]);
    expect(s).toEqual(["/", "/learn", "/learn/hay-milk"]);
    expect(canGoBackInSite(s)).toBe(true);
  });
  it("뒤로(traverse)면 맨 위를 뺀다", () => {
    expect(nextStack(["/", "/learn", "/learn/hay-milk"], "/learn", "traverse")).toEqual(["/", "/learn"]);
  });
  it("새로고침(같은 주소)은 그대로", () => {
    expect(nextStack(["/", "/faq"], "/faq", "push")).toEqual(["/", "/faq"]);
  });
  it("링크로 바로 들어온 첫 화면은 뒤로 갈 곳이 없다 → 목록으로", () => {
    expect(canGoBackInSite(run([["/learn/certified-farm", "push"]]))).toBe(false);
  });
  it("★ 로그인 가드 replace 를 push 로 세지 않는다 — 제품 → 바로 구매(/checkout) → /login(replace) → 이전 → 제품에서는 더 갈 곳 없음", () => {
    let s = run([["/products/milk-750", "push"], ["/checkout", "push"], ["/login", "replace"]]);
    expect(s).toEqual(["/products/milk-750", "/login"]);
    s = nextStack(s, "/products/milk-750", "traverse");
    expect(s).toEqual(["/products/milk-750"]);
    expect(canGoBackInSite(s)).toBe(false); // → 목록(/#products)으로, 사이트 밖으로 나가지 않는다
  });
  it("★ 갱신 문자 링크(/account) → 로그인 가드 replace: 앞 화면 없음", () => {
    expect(canGoBackInSite(run([["/account", "push"], ["/login", "replace"]]))).toBe(false);
  });
  it("모르는 곳으로의 traverse(앞으로 가기 등)는 처음부터 — 덜 세는 쪽", () => {
    expect(nextStack(["/", "/learn"], "/faq", "traverse")).toEqual(["/faq"]);
  });
  it("기록은 50개까지만", () => {
    let s: string[] = [];
    for (let i = 0; i < 80; i++) s = nextStack(s, `/learn/p${i}`, "push");
    expect(s).toHaveLength(50);
  });
  it("이동 방식 가리기: popstate=traverse, 기록 수 증가=push, 그대로=replace", () => {
    expect(classifyVisit({ traversal: true, lengthBefore: 3, lengthNow: 3 })).toBe("traverse");
    expect(classifyVisit({ traversal: false, lengthBefore: 3, lengthNow: 4 })).toBe("push");
    expect(classifyVisit({ traversal: false, lengthBefore: 3, lengthNow: 3 })).toBe("replace");
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
  it("Navigation API 가 있으면 그것으로 고른다(사이트 밖으로 나갈 수 없다)", () => {
    expect(btn).toMatch(/pickBackDelta\(nav\.entries\(\), nav\.currentEntry!\.index\)/);
    expect(btn).toMatch(/classifyVisit\(/);
  });
});
