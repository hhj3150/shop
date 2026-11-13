import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  LEARN_PAGES,
  LEARN_HUB,
  LEARN_SLUGS,
  getLearnPage,
  learnFarmNote,
  learnPageText,
  learnSitemapEntries,
  learnLlmsLines,
  formatKoDate,
} from "./learn";
import { buildLearnArticle, buildLearnHub } from "./learn-schema";
import { ORG_ID, WEBSITE_ID } from "./schema";
import { PAGE_SEO, homeSeo, storySeo, productSeo } from "./copy";
import { activeCertifications } from "@/lib/certifications";
import { PUBLIC_PRODUCTS } from "@/lib/products";
import { SITE_URL } from "@/lib/site";

// /learn 해설 페이지 — 구조(질문형 소제목·출처)와 문구(금지 표현) 래칫.
//   금지 규칙은 lib/seo/claims.test.ts 의 AUTHORED_BANNED 와 같다(테스트 파일은 import 하면
//   그 파일의 테스트까지 다시 돌아서 여기 복제한다 — 그쪽에 규칙이 늘면 여기에도 더한다).
//   더해서: 1885년 저지 이야기의 금지 표현(korea-jersey-1885-history.md), 효능 화제 전체,
//   인증을 제품 인증처럼 쓰는 표현, 기밀 화제.

const root = join(__dirname, "..", "..");
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TODAY = "2026-11-12";
const certs = activeCertifications(TODAY);

// ── claims.test.ts 와 같은 규칙 ──
const FACT_BANNED: [string, RegExp][] = [
  ["건초만/풀만(사실과 다름)", /건초(?:로)?만|풀(?:로)?만|100%\s*건초|곡물\s*무급여/],
  ["방목(자유방목 인증 '부')", /방목(?!\s*인증)/],
  ["폐기된 0.01%", /0\.01\s*%/],
  ["효능 표현", /BCM|면역|장[-–]뇌|소화가\s*잘|소화에\s*좋|속이\s*편/],
  ["grass-fed(사실과 다름)", /grass[- ]?fed/i],
];
const AUTHORED_BANNED: [string, RegExp][] = [
  ...FACT_BANNED,
  ["비교(일반 우유·~보다)", /일반\s*우유|보다\s*(더|진하|건강|맛)/],
  ["근거 없는 최상급", /국내\s*최초|최고의|최상급|국내\s*유일/],
];
// ── 해설 페이지에 더하는 규칙 ──
const LEARN_BANNED: [string, RegExp][] = [
  ...AUTHORED_BANNED,
  // korea-jersey-1885-history.md: 범위 없는 '최초의 젖소', 후손·혈통 주장, 창업 연도로 읽히는 표기
  ["1885년 저지의 후손/혈통", /1885년\s*저지의\s*(후손|혈통)/],
  ["Since 1885", /since\s*1885/i],
  ["한국 최초의 젖소(범위 없이)", /한국(?:의)?\s*(?:최초|첫)(?:의)?\s*젖소/],
  ["국내 유일·최초 저지우유", /(?:유일|최초)(?:의)?\s*저지\s*우유/],
  // 효능 화제는 아예 다루지 않는다(정의·구분만) — '소화'라는 낱말도 쓰지 않는다.
  ["소화·효능 화제", /소화|베타-?카소모르핀|casomorphin|효능이\s*있|건강에\s*(좋|도움|이로)|질병\s*예방/i],
  // 인증은 목장 인증 — 제품 인증처럼 쓰지 않는다.
  ["제품 인증 표현", /(동물복지|저탄소|HACCP|해썹)\s*(인증\s*)?(우유|요거트|제품)(?!\s*을\s*심사)/],
  ["유기농 우유 표현", /유기농\s*(우유|요거트)/],
  // 기밀: Dr. Ha Liquid 출처·메탄 저감 전략·한우 유전자원 수출
  ["기밀 화제", /메탄|methane|Dr\.?\s*Ha\b|리퀴드|한우[^.]*수출|수출[^.]*한우/i],
];

const allTexts = (): [string, string][] => [
  ...LEARN_PAGES.map((p) => [`page:${p.slug}`, learnPageText(p)] as [string, string]),
  ...LEARN_PAGES.map(
    (p) =>
      [`note:${p.slug}`, JSON.stringify(learnFarmNote(p.slug, { certifications: certs }))] as [
        string,
        string,
      ]
  ),
  ["hub", `${LEARN_HUB.title}\n${LEARN_HUB.description}`],
  ...LEARN_PAGES.map((p) => [`jsonld:${p.slug}`, JSON.stringify(buildLearnArticle(p))] as [string, string]),
  ["llms", learnLlmsLines().join("\n")],
];

describe("해설 페이지 — 구조", () => {
  it("요청된 4편이 있고 slug 가 겹치지 않는다", () => {
    expect([...LEARN_SLUGS].sort()).toEqual(
      ["a2-milk", "certified-farm", "hay-milk", "jersey-milk"].sort()
    );
    expect(new Set(LEARN_SLUGS).size).toBe(LEARN_SLUGS.length);
    for (const s of LEARN_SLUGS) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  for (const p of LEARN_PAGES) {
    describe(p.slug, () => {
      it("첫 문단(결론)이 있다", () => {
        expect(p.intro.trim().length).toBeGreaterThanOrEqual(60);
      });
      it("질문형 소제목 3개 이상, 소제목마다 본문이 있다", () => {
        expect(p.sections.length).toBeGreaterThanOrEqual(3);
        for (const s of p.sections) {
          expect(s.heading, s.heading).toMatch(/\?$/);
          expect(s.paragraphs.length, s.heading).toBeGreaterThan(0);
          for (const para of s.paragraphs) expect(para.trim().length, s.heading).toBeGreaterThan(20);
        }
        expect(new Set(p.sections.map((s) => s.heading)).size).toBe(p.sections.length);
      });
      it("출처 2개 이상, 모두 https 주소·연도·이름", () => {
        expect(p.sources.length).toBeGreaterThanOrEqual(2);
        for (const s of p.sources) {
          expect(s.url, s.name).toMatch(/^https:\/\/[^\s]+$/);
          expect(() => new URL(s.url), s.url).not.toThrow();
          expect(Number.isInteger(s.year), s.name).toBe(true);
          expect(s.year, s.name).toBeGreaterThanOrEqual(1800);
          expect(s.year, s.name).toBeLessThanOrEqual(Number(TODAY.slice(0, 4)));
          expect(s.name.trim().length, s.url).toBeGreaterThan(3);
        }
        expect(new Set(p.sources.map((s) => s.url)).size).toBe(p.sources.length);
      });
      it("설명은 60–130자, 제목은 40자 이내·낱말 반복 없음", () => {
        expect(p.description.length, p.description).toBeGreaterThanOrEqual(60);
        expect(p.description.length, p.description).toBeLessThanOrEqual(130);
        expect(p.title.length, p.title).toBeLessThanOrEqual(40);
        const words = p.title.split(/[\s·—|(),]+/).filter((w) => w.length >= 2);
        expect(words.filter((w, i) => words.indexOf(w) !== i), p.title).toEqual([]);
      });
      it("날짜는 YYYY-MM-DD, 공개일 ≤ 수정일", () => {
        expect(p.published).toMatch(YMD);
        expect(p.updated).toMatch(YMD);
        expect(p.published <= p.updated).toBe(true);
        expect(p.about.length).toBeGreaterThan(0);
      });
    });
  }

  it("설명은 해설끼리도, 기존 페이지 설명과도 겹치지 않는다(네이버: 중복 설명 불이익)", () => {
    const existing = [
      homeSeo(certs).description,
      storySeo(certs).description,
      ...Object.values(PAGE_SEO).map((v) => v.description),
      ...PUBLIC_PRODUCTS.map((p) => productSeo(p).description),
    ];
    const mine = [LEARN_HUB.description, ...LEARN_PAGES.map((p) => p.description)];
    expect(new Set(mine).size).toBe(mine.length);
    for (const d of mine) expect(existing).not.toContain(d);
    expect(LEARN_HUB.description.length).toBeGreaterThanOrEqual(60);
    expect(LEARN_HUB.description.length).toBeLessThanOrEqual(130);
    expect(LEARN_HUB.title.length).toBeLessThanOrEqual(40);
  });

  it("getLearnPage 는 없는 slug 에 undefined", () => {
    expect(getLearnPage("a2-milk")?.slug).toBe("a2-milk");
    expect(getLearnPage("nope")).toBeUndefined();
  });

  it("formatKoDate", () => {
    expect(formatKoDate("2026-11-02")).toBe("2026년 11월 2일");
  });

  it("라우트 파일이 있다(app/learn, app/learn/[slug])", () => {
    expect(existsSync(join(root, "app/learn/page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app/learn/[slug]/page.tsx"))).toBe(true);
  });
});

describe("해설 페이지 — 금지 표현(claims.test.ts 규칙 + 1885·효능·제품 인증·기밀)", () => {
  for (const [where, text] of allTexts()) {
    it(where, () => {
      for (const [why, re] of LEARN_BANNED) expect(text, `${where}: ${why}`).not.toMatch(re);
    });
  }

  it("규칙이 실제로 잡는다(자기 점검)", () => {
    const hit = (s: string) => LEARN_BANNED.some(([, re]) => re.test(s));
    expect(hit("1885년 저지의 후손입니다")).toBe(true);
    expect(hit("Since 1885")).toBe(true);
    expect(hit("한국 최초의 젖소")).toBe(true);
    expect(hit("한국의 첫 젖소")).toBe(true);
    expect(hit("동물복지 우유")).toBe(true);
    expect(hit("HACCP 인증 우유")).toBe(true);
    expect(hit("건초만 먹인")).toBe(true);
    expect(hit("소화가 잘 되는")).toBe(true);
    expect(hit("현재 확인되는 기록으로는 서양 젖소 품종이 한국에 들어온 가장 이른 사례")).toBe(false);
  });
});

describe("해설 페이지 — 꼭 들어가야 할 사실", () => {
  const text = (slug: string) => learnPageText(getLearnPage(slug)!);
  const sourceUrls = (slug: string) => getLearnPage(slug)!.sources.map((s) => s.url);

  it("A2: 67번째 아미노산(프롤린/히스티딘), 유당은 그대로", () => {
    const t = text("a2-milk");
    expect(t).toMatch(/67번째/);
    expect(t).toMatch(/프롤린/);
    expect(t).toMatch(/히스티딘/);
    expect(t).toMatch(/유당/);
    expect(t).toMatch(/무유당\(락토프리\) 제품이 아닙니다/);
    // EFSA 는 인과관계 부정 외 용도로 인용하지 않는다 — 이 글은 효능을 다루지 않으므로 인용하지 않는다.
    expect(sourceUrls("a2-milk").join(" ")).not.toMatch(/efsa/i);
  });

  it("저지: FRUS 1885 문서 247을 인용하고, 지금 소는 1885년 소의 후손이 아니라고 밝힌다", () => {
    expect(sourceUrls("jersey-milk")).toContain(
      "https://history.state.gov/historicaldocuments/frus1885/d247"
    );
    const t = text("jersey-milk");
    expect(t).toMatch(/암소 2두와 수소 1두/);
    expect(t).toMatch(/현재 확인되는 기록/);
    const note = learnFarmNote("jersey-milk", { certifications: certs }).paragraphs.join(" ");
    expect(note).toMatch(/1885년에 들어온 소들의 후손이 아닙?니?/);
  });

  it("헤이밀크: EU 규정 2016/304 를 인용하고, 송영신목장은 EU 인증 제품이 아니라고 밝힌다", () => {
    expect(sourceUrls("hay-milk").some((u) => u.includes("2016/304"))).toBe(true);
    const t = text("hay-milk");
    expect(t).toMatch(/2016/);
    expect(t).toMatch(/EU (TSG )?인증(을 받은)? 제품은 아니/);
    expect(t).toMatch(/사일리지\(발효사료\) 없이 건초를 중심으로/);
    const note = learnFarmNote("hay-milk", { certifications: certs }).paragraphs.join(" ");
    expect(note).toMatch(/TSG\) 인증 제품은 아닙니다/);
  });

  it("인증 목장: 세 발급기관의 공식 자료를 인용하고, 농장 인증·유기 인증 없음을 밝힌다", () => {
    const urls = sourceUrls("certified-farm").join(" ");
    expect(urls).toMatch(/lemi\.or\.kr/); // 축산환경관리원
    expect(urls).toMatch(/mafra\.go\.kr/); // 저탄소(축산물품질평가원 접수) — 농식품부 보도자료
    expect(urls).toMatch(/haccp\.or\.kr/); // 한국식품안전관리인증원
    const t = text("certified-farm");
    expect(t).toMatch(/'인증 목장'/);
    const note = learnFarmNote("certified-farm", { certifications: certs });
    expect(note.paragraphs.join(" ")).toMatch(/제품 인증이 아닙니다/);
    expect(note.paragraphs.join(" ")).toMatch(/유기\(유기농\) 인증은 받지 않았습니다/);
  });
});

describe("'송영신목장에서는' 상자 — SSOT 에서 조립", () => {
  it("인증 목록은 오늘 기준 유효한 것만(만료 인증 제외)", () => {
    const now = learnFarmNote("certified-farm", { certifications: certs }).list.join("\n");
    expect(now).toMatch(/동물복지축산농장 인증/);
    expect(now).toMatch(/저탄소 축산물 농장 인증/);
    expect(now).toMatch(/HACCP/);
    expect(now).not.toMatch(/깨끗한 축산농장/); // 2026-04-18 만료
    const later = learnFarmNote("certified-farm", {
      certifications: activeCertifications("2027-10-10"),
    }).list.join("\n");
    expect(later).not.toMatch(/저탄소/); // 2027-10-09 만료
    const none = learnFarmNote("certified-farm", { certifications: [] });
    expect(none.list).toEqual([]);
    expect(none.paragraphs.join(" ")).toMatch(/유효한 목장 인증이 없습니다/);
  });

  it("제품 사실은 lib/products.ts 라벨 값 그대로", () => {
    const milk = PUBLIC_PRODUCTS.find((p) => p.line === "milk")!;
    const a2 = learnFarmNote("a2-milk", { certifications: certs }).paragraphs.join(" ");
    expect(a2).toContain(milk.label.ingredients.split(" · ")[0]);
    const hay = learnFarmNote("hay-milk", { certifications: certs }).paragraphs.join(" ");
    expect(hay).toContain(milk.label.sterilization!.split(" · ")[0]);
    expect(hay).toMatch(/75℃, 20초/);
  });

  it("상자 링크는 실제 있는 공개 주소만", () => {
    const publicIds = new Set(PUBLIC_PRODUCTS.map((p) => p.id));
    for (const slug of LEARN_SLUGS) {
      const note = learnFarmNote(slug, { certifications: certs });
      expect(note.paragraphs.length + note.list.length, slug).toBeGreaterThan(0);
      expect(note.links.length, slug).toBeGreaterThan(0);
      for (const l of note.links) {
        const m = l.href.match(/^\/products\/(.+)$/);
        if (m) expect(publicIds.has(m[1]), l.href).toBe(true);
        else expect(existsSync(join(root, `app${l.href}/page.tsx`)), l.href).toBe(true);
      }
    }
  });
});

describe("구조화데이터 — Article·CollectionPage", () => {
  for (const p of LEARN_PAGES) {
    it(`Article(${p.slug})`, () => {
      const a = buildLearnArticle(p);
      const url = `${SITE_URL}/learn/${p.slug}`;
      expect(a["@type"]).toBe("Article");
      expect(a["@id"]).toBe(`${url}#article`);
      expect(a.url).toBe(url);
      expect(a.headline).toBe(p.title);
      expect(a.headline.length).toBeLessThanOrEqual(110);
      expect(a.inLanguage).toBe("ko-KR");
      expect(a.author).toEqual({ "@id": ORG_ID });
      expect(a.publisher).toEqual({ "@id": ORG_ID });
      expect(a.isPartOf).toEqual({ "@id": WEBSITE_ID });
      expect(a.datePublished).toBe(p.published);
      expect(a.dateModified).toBe(p.updated);
      expect(a.about.length).toBe(p.about.length);
      expect(a.citation.map((c) => c.url)).toEqual(p.sources.map((s) => s.url));
      // 열람 연도만 아는 출처에는 발행일을 지어내지 않는다.
      for (const [i, s] of p.sources.entries()) {
        expect("datePublished" in a.citation[i], s.name).toBe(!s.accessed);
      }
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    });
  }

  it("허브 CollectionPage 는 글 4편을 순서대로 나열한다", () => {
    const h = buildLearnHub(LEARN_PAGES);
    expect(h["@type"]).toBe("CollectionPage");
    expect(h.url).toBe(`${SITE_URL}/learn`);
    expect(h.mainEntity.itemListElement.map((it) => it.url)).toEqual(
      LEARN_PAGES.map((p) => `${SITE_URL}/learn/${p.slug}`)
    );
    expect(h.mainEntity.itemListElement.map((it) => it.position)).toEqual([1, 2, 3, 4]);
  });
});

describe("통합용 내보내기 — sitemap·llms", () => {
  it("sitemap 항목: 허브 + 4편, 날짜 YYYY-MM-DD, 허브 날짜 = 가장 늦은 글 날짜", () => {
    const e = learnSitemapEntries();
    expect(e.map((x) => x.path)).toEqual(["/learn", ...LEARN_SLUGS.map((s) => `/learn/${s}`)]);
    for (const x of e) expect(x.updated).toMatch(YMD);
    expect(e[0].updated).toBe([...LEARN_PAGES.map((p) => p.updated)].sort().at(-1));
    for (const x of e) expect(x.path).not.toMatch(/[&<>"]/);
  });

  it("llms 줄은 llmstxt.org 링크 형식이다", () => {
    const lines = learnLlmsLines();
    expect(lines.length).toBe(LEARN_PAGES.length + 1);
    for (const l of lines) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)\s]+\)(: .+)?$/);
  });
});
