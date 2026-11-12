import { describe, it, expect } from "vitest";
import { PUBLIC_PRODUCTS } from "@/lib/products";
import { activeCertifications } from "@/lib/certifications";
import {
  SITE_DESCRIPTION,
  ORG_DESCRIPTION,
  PAGE_SEO,
  homeSeo,
  storySeo,
  productSeo,
} from "./copy";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms";
import { FAQ_ITEMS, moreFaqItems } from "./faq";
import { buildOrganization, buildLocalBusiness, buildProduct } from "./schema";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// 검색 결과·AI 답변으로 퍼지는 문구(제목·설명·구조화데이터·llms·문답)에 금지 표현이 없는지 — 래칫.
//   근거: docs/브랜드-카피-가이드.md(금지어·'사실과 다른 표현'), 식품표시광고법(효능 표현),
//   lib/certifications.ts(자유방목 '부'·유기 인증 없음), 2026-11-11 '0.01%' 폐기 결정.
//   새 금지어가 생기면 여기에 더한다. 걸리면 문구를 고친다(테스트를 느슨하게 하지 않는다).

const certs = activeCertifications("2026-11-12");
const input = { certifications: certs, cardPayment: false };

// 사실과 다른 표현·폐기 수치·효능 — 모든 표면에서 금지.
const FACT_BANNED: [string, RegExp][] = [
  ["건초만/풀만(사실과 다름)", /건초(?:로)?만|풀(?:로)?만|100%\s*건초|곡물\s*무급여/],
  ["방목(자유방목 인증 '부')", /방목(?!\s*인증)/],
  ["폐기된 0.01%", /0\.01\s*%/],
  ["효능 표현", /BCM|면역|장[-–]뇌|소화가\s*잘|소화에\s*좋|속이\s*편/],
  ["grass-fed(사실과 다름)", /grass[- ]?fed/i],
];
// 비교·근거 없는 최상급 — 이번에 새로 쓴 표면(제목·설명·구조화데이터·llms 요약·추가 문답)에서 금지.
//   기존 FAQ_ITEMS 의 '일반 우유' 문항은 문구 결정(사장님·표시광고 검토) 전이라 이 목록에서 뺀다.
const AUTHORED_BANNED: [string, RegExp][] = [
  ...FACT_BANNED,
  ["비교(일반 우유·~보다)", /일반\s*우유|보다\s*(더|진하|건강|맛)/],
  ["근거 없는 최상급", /국내\s*최초|최고의|최상급|국내\s*유일/],
];

const authored: [string, string][] = [
  ["SITE_DESCRIPTION", SITE_DESCRIPTION],
  ["ORG_DESCRIPTION", ORG_DESCRIPTION],
  ...Object.entries(PAGE_SEO).flatMap(([k, v]) => [
    [`PAGE_SEO.${k}.title`, v.title] as [string, string],
    [`PAGE_SEO.${k}.description`, v.description] as [string, string],
  ]),
  ["homeSeo", JSON.stringify(homeSeo(certs))],
  ["storySeo", JSON.stringify(storySeo(certs))],
  ...PUBLIC_PRODUCTS.map((p) => [`productSeo(${p.id})`, JSON.stringify(productSeo(p))] as [string, string]),
  ...PUBLIC_PRODUCTS.map((p) => [`buildProduct(${p.id})`, JSON.stringify(buildProduct(p))] as [string, string]),
  ["buildOrganization", JSON.stringify(buildOrganization({ certifications: certs }))],
  ["buildLocalBusiness", JSON.stringify(buildLocalBusiness())],
  ["llms.txt", buildLlmsTxt(input)],
  ["moreFaqItems", JSON.stringify(moreFaqItems(certs))],
];

describe("검색·AI 표면 금지 표현 — 새로 쓴 문구", () => {
  for (const [where, text] of authored) {
    it(where, () => {
      for (const [why, re] of AUTHORED_BANNED) expect(text, `${where}: ${why}`).not.toMatch(re);
    });
  }
});

describe("검색·AI 표면 금지 표현 — 기존 문답과 llms-full", () => {
  it("FAQ_ITEMS 에 사실과 다른 표현·효능 표현이 없다", () => {
    const t = JSON.stringify(FAQ_ITEMS);
    for (const [why, re] of FACT_BANNED) expect(t, why).not.toMatch(re);
  });
  it("llms-full.txt", () => {
    const t = buildLlmsFullTxt(input);
    for (const [why, re] of FACT_BANNED) expect(t, why).not.toMatch(re);
  });
});

describe("길이 — 검색 결과에서 잘리지 않게", () => {
  const titles: [string, string][] = [
    ["home", homeSeo(certs).title],
    ["story", storySeo(certs).title],
    ...Object.entries(PAGE_SEO).map(([k, v]) => [k, v.title] as [string, string]),
    ...PUBLIC_PRODUCTS.map((p) => [p.id, productSeo(p).title] as [string, string]),
  ];
  it("제목은 40자 이내(접미사 제외)", () => {
    for (const [k, t] of titles) expect(t.length, `${k}: ${t}`).toBeLessThanOrEqual(40);
  });
  const descs: [string, string][] = [
    ["home", homeSeo(certs).description],
    ["story", storySeo(certs).description],
    ...Object.entries(PAGE_SEO).map(([k, v]) => [k, v.description] as [string, string]),
    ...PUBLIC_PRODUCTS.map((p) => [p.id, productSeo(p).description] as [string, string]),
  ];
  it("설명은 50–160자", () => {
    for (const [k, d] of descs) {
      expect(d.length, `${k}: ${d}`).toBeGreaterThanOrEqual(50);
      expect(d.length, `${k}: ${d}`).toBeLessThanOrEqual(160);
    }
  });
  it("제목 안에서 같은 낱말을 되풀이하지 않는다(네이버: 반복 키워드 불이익)", () => {
    for (const [k, t] of titles) {
      const words = t.split(/[\s·—|(),]+/).filter((w) => w.length >= 2);
      const dup = words.filter((w, i) => words.indexOf(w) !== i);
      expect(dup, `${k}: ${t}`).toEqual([]);
    }
  });

  it("페이지마다 설명이 다르다(네이버: 중복 설명은 불이익)", () => {
    expect(new Set(descs.map(([, d]) => d)).size).toBe(descs.length);
  });
});

describe("우유 문답은 '발효'를 말하지 않는다(우유는 살균, 발효는 요거트)", () => {
  it("헤이밀크 문답(요거트 제외) 답변에 발효(사료 제외)가 없다", () => {
    const milkQs = [...FAQ_ITEMS, ...moreFaqItems(certs)].filter(
      (f) => f.question.includes("헤이밀크") && !f.question.includes("요거트")
    );
    expect(milkQs.length).toBeGreaterThan(0);
    for (const f of milkQs) expect(f.answer, f.question).not.toMatch(/발효(?!사료)/);
  });
});

// 손님 화면 소스(공개 페이지·컴포넌트)도 사실과 다른 표현을 쓰지 않는다 — 문자열 리터럴 기준.
//   lib/assistant/knowledge.ts(고객 도우미 지식)는 별도 정리 대상이라 여기서 뺀다(docs/seo-geo-운영가이드.md §4).
describe("공개 화면 소스 — 사실과 다른 표현 없음", () => {
  const root = join(__dirname, "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(f) ? [p] : [];
    });
  const files = [
    ...walk(join(root, "components")),
    ...walk(join(root, "app")).filter((f) => !f.includes(`${join("app", "admin")}`) && !f.includes(`${join("app", "api")}`)),
  ];
  const strip = (src: string) =>
    src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l))
      .join("\n");
  it("건초만·풀만·풀로만·건초로만이 없다", () => {
    expect(files.length, "검사 대상 파일을 찾지 못했다").toBeGreaterThan(50);
    const re = FACT_BANNED[0][1];
    for (const f of files) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(re);
  });
});
