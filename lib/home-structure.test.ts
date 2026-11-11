// 홈은 '사러 온 사람'의 화면이다 — 이 순서가 조용히 되돌아가지 않게 지킨다.
//   2026-11 개편 전에는 상품 목록 앞에 이름 풀이가, 상품과 구독 안내 사이에 목장 사진·희소성·
//   재생농업·세계 낙농 소식이 끼어 있어 모바일 홈이 화면 17장 길이였다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const home = read("app/page.tsx");
const body = home.slice(home.indexOf("export default function Home"));
const order = [...body.matchAll(/<([A-Z][A-Za-z]+)\b/g)].map((m) => m[1]).filter((n) => n !== "JsonLd");

describe("홈의 순서 — 상품이 먼저", () => {
  it("인사 바로 다음이 상품 목록이다", () => {
    expect(order[0]).toBe("Hero");
    expect(order[1]).toBe("ProductShowcase");
  });

  it("사는 방법(1회 구매 · 정기구독) 안내가 상품 목록 바로 뒤에 온다", () => {
    expect(order[2]).toBe("HowToBuy");
  });

  it("읽을거리(재생농업·소식·희소성)는 홈에 없다 — /story 에 있다", () => {
    for (const name of ["RegenerativeBand", "NewsBand", "NewsRadarBand", "Provenance"]) {
      expect(order, `${name} 이 홈으로 돌아왔다`).not.toContain(name);
      expect(read("app/story/page.tsx")).toContain(`<${name} />`);
    }
  });
});

describe("1회 구매가 숨지 않는다", () => {
  it("홈에 회원가입 없이 사는 길(/order-once)이 있다", () => {
    expect(read("components/HowToBuy.tsx")).toContain('href: "/order-once"');
  });

  // 상품 카드의 대표 가격은 정가다. 회원가를 대표 가격으로 되돌리면 1회 구매 손님은
  //   상세에 들어가서야 실제 값을 안다.
  it("상품 카드의 큰 가격은 정가(p.price)다", () => {
    const card = read("components/ProductShowcase.tsx");
    expect(card).toMatch(/\{formatKRW\(p\.price\)\}\s*<\/p>/);
    expect(card).not.toContain("회원가</span>");
  });

  // 실제로는 비회원 1회 구매가 된다. '회원께만 판다'는 문장이 다시 생기면 손님이 돌아선다.
  it("고객 화면에 '우유는 회원께만' 식의 문장이 없다", () => {
    for (const f of ["app/signup/page.tsx", "components/VisitStore.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/우유는\s*<span[^>]*>회원으로 모신 분께만/);
      expect(src, f).not.toContain("온라인은 회원께만");
    }
  });

  // 첫 화면을 상품에 내주느라 히어로에서 뺀 문장이 사이트에서 통째로 사라지면 안 된다.
  it("'하루 500리터만 생산합니다'는 홈 어딘가에 남아 있다", () => {
    expect(read("components/WhyBand.tsx")).toContain("하루 500리터만 생산합니다.");
  });
});
