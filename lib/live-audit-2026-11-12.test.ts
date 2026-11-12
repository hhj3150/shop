// 2026-11-12 운영 사이트 감사(구조화데이터·크롤링·사실·해설 콘텐츠 4관점 + 반박 검증)에서 확인된
// 결함이 다시 생기지 않게 막는다. 검색·AI 는 화면·구조화데이터·llms 의 문장을 그대로 인용한다 —
// 한 사이트 안에서 사실이 둘로 갈리면 어느 쪽이 인용될지 모른다.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_PRODUCTS } from "@/lib/products";
import { buildMembershipBenefits } from "@/lib/membership-benefits";
import { FAQ_ITEMS, moreFaqItems } from "@/lib/seo/faq";
import { activeCertifications } from "@/lib/certifications";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";
import { rawMilkBadgeTitle } from "@/components/TrustBadges";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const certs = activeCertifications("2026-11-12");

describe("신선도·해지 — 가입 화면이 FAQ·약관과 같은 사실을 말한다", () => {
  const text = JSON.stringify(buildMembershipBenefits());
  it("새벽 착유·직배송·'어디도 거치지 않고'를 말하지 않는다(실제: 아침 착유, 다음 날 택배)", () => {
    expect(text).not.toMatch(/새벽|직배송|거치지\s*않고/);
    expect(text).toContain("다음 날");
  });
  it("해지는 약관 제7조대로 — 언제든 해지, 미배송 회차분 환불('입금 전 취소'만 말하지 않는다)", () => {
    expect(text).not.toMatch(/입금\s*전\s*취소/);
    expect(text).toMatch(/언제든\s*해지/);
    expect(text).toMatch(/배송되지\s*않은\s*회차분/);
  });
  it("FAQ 도 언제든 해지·미배송 회차분 환불을 안내한다(홈·/faq·구조화데이터·llms)", () => {
    const refund = FAQ_ITEMS.find((f) => f.question.includes("환불"));
    expect(refund?.answer).toMatch(/언제든\s*해지/);
    expect(moreFaqItems(certs).some((f) => /해지/.test(f.question))).toBe(true);
  });
});

describe("알레르기 안내는 한 가지로 — 전문가와 상의", () => {
  it("'소량으로 먼저 드셔 보라'는 권유가 없다", () => {
    const all = JSON.stringify([...FAQ_ITEMS, ...moreFaqItems(certs)]);
    expect(all).not.toMatch(/소량으로\s*먼저|알레르기[^.。]*드셔\s*보/);
    expect(all).toMatch(/알레르기[^.。]*전문가와\s*상의/);
  });
});

describe("요거트 원재료 — '원유 100%'는 우유에만", () => {
  for (const p of PUBLIC_PRODUCTS.filter((x) => x.line === "milk" || x.line === "yogurt")) {
    const is100 = /원유\s*100%/.test(p.label?.ingredients ?? "");
    it(`${p.id}: 표시사항이 100% 가 아니면 정체성 한 줄·배지에 '100%'가 없다`, () => {
      if (is100) return;
      expect(p.signature?.identity ?? "").not.toMatch(/100\s*%/);
      expect(rawMilkBadgeTitle(p.line as "milk" | "yogurt")).not.toMatch(/100\s*%/);
    });
  }
  it("우유 배지는 원유 100% 를 유지한다", () => {
    expect(rawMilkBadgeTitle("milk")).toMatch(/100%/);
  });
});

describe("요거트 당류 강조 문구 — 표시사항 값과 같다(비교 수치 없음)", () => {
  for (const p of PUBLIC_PRODUCTS.filter((x) => x.line === "yogurt")) {
    it(p.id, () => {
      const em = (p.highlights?.rows ?? []).map((r) => r.em ?? "").join(" ");
      expect(em).not.toMatch(/→/);
      const m = em.match(/당류\s*([\d.]+)\s*g\s*\((\d+)mL당\)/);
      expect(m, em).not.toBeNull();
      // 표시사항은 100mL당(500mL) 또는 병당(180mL) — 100mL 로 환산해 같은지 본다.
      const basis = p.nutrition?.basis ?? "";
      const row = p.nutrition?.rows.find((r) => r.label === "당류");
      const per = Number(basis.match(/(\d+)mL/)?.[1]);
      const per100 = (parseFloat(row?.amount ?? "NaN") / per) * 100;
      expect(Math.abs(per100 - Number(m![1]))).toBeLessThan(0.06);
    });
  }
});

describe("홈·스토리 카피 — 비교·효능 암시·용어 통일", () => {
  it("홈 이름 풀이에 비교('더 진하고')·영양 암시('풀의 영양')가 없다", () => {
    expect(src("components/WhyBand.tsx").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/더\s*진하|풀의\s*영양/);
  });
  it("목장 집사 소개에 '소화'가 없다", () => {
    expect(src("components/ConciergeInvite.tsx")).not.toMatch(/소화/);
  });
  it("베타카제인으로 통일한다(화면·도우미)", () => {
    expect(src("components/Provenance.tsx")).not.toMatch(/베타카세인/);
    expect(buildCustomerSystemPrompt()).not.toMatch(/베타카세인/);
  });
  it("도우미가 A2 를 '더 편하다'고 말하도록 지시하지 않는다", () => {
    expect(buildCustomerSystemPrompt()).not.toMatch(/더\s*편하게\s*느껴진다/);
  });
});

describe("크롤링 — 서버 HTML 에 내용이 있다", () => {
  it("/order-once 페이지는 서버 컴포넌트이고 제목(h1)·제품 목록을 서버에서 그린다", () => {
    const page = src("app/order-once/page.tsx");
    expect(page).not.toMatch(/^"use client"/m);
    expect(page).toMatch(/<h1/);
    expect(page).toMatch(/livePublicProducts/);
    // 주문서(클라이언트)의 대체 화면·준비 전 화면이 그 소개를 쓴다('불러오는 중…' 한 줄이 아니다).
    const client = src("app/order-once/OrderOnceClient.tsx");
    expect(client).toMatch(/fallback=\{staticView\}/);
    expect(client).toMatch(/if \(!ready\) return <>\{staticView\}<\/>/);
  });
  it("FarmBand 캡션 제목은 한 벌이다(/story 의 h1 이 둘이 되지 않게)", () => {
    expect(src("components/FarmBand.tsx").match(/<Title\b/g)?.length).toBe(1);
  });
  it("루트 404 화면이 있고 자기 <title> 을 그리지 않는다(제목 중복 방지)", () => {
    expect(existsSync(join(root, "app/not-found.tsx"))).toBe(true);
    expect(src("app/not-found.tsx").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(/<title/);
  });
});

describe("해설 출처 — EU 2016/304 관보 쪽수", () => {
  it("OJ L 58 의 28–34쪽이다", () => {
    const learn = src("lib/seo/learn.ts");
    expect(learn).toContain("OJ L 58, 4.3.2016, pp. 28–34");
    expect(learn).not.toMatch(/4\.3\.2016, p\. 5\b/);
  });
});
