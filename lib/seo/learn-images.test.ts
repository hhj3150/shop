import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LEARN_IMAGES, LEARN_HUB_IMAGE } from "./learn-images";
import { LEARN_SLUGS, getLearnPage } from "./learn";
import { buildLearnArticle, buildLearnHub } from "./learn-schema";
import { LEARN_PAGES } from "./learn";
import { SITE_URL } from "@/lib/site";

const root = join(__dirname, "..", "..");
const pub = (p: string) => join(root, "public", p.replace(/^\//, ""));

// JPEG 크기(SOF 마커) — 공유 카드가 1200×630 인지
function jpegSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  expect(b[0] === 0xff && b[1] === 0xd8, `${path} 는 JPEG 여야 한다(카카오톡은 WEBP 공유 이미지를 읽지 않는다)`).toBe(true);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error(`SOF 없음: ${path}`);
}

const all = [...Object.entries(LEARN_IMAGES), ["(hub)", LEARN_HUB_IMAGE] as const];

describe("해설 사진 — 파일·공유 카드·설명", () => {
  for (const [slug, img] of all) {
    it(`${slug}`, () => {
      if (slug !== "(hub)") expect(LEARN_SLUGS, "있는 해설 글에만 사진을 단다").toContain(slug);
      expect(existsSync(pub(img.src)), img.src).toBe(true);
      expect(img.src).toMatch(/\.webp$/);
      expect(img.width / img.height).toBeCloseTo(3 / 4, 2);
      const og = jpegSize(pub(img.og));
      expect(og).toEqual({ w: 1200, h: 630 });
      expect(img.alt.trim().length).toBeGreaterThan(10);
      // 사료 사실(생풀 급여 없음)과 어긋나는 묘사 금지
      expect(`${img.alt} ${img.caption ?? ""}`).not.toMatch(/풀을\s*(뜯|먹)|풀과\s*건초|방목/);
    });
  }
});

describe("구조화데이터·허브가 사진을 쓴다", () => {
  it("사진이 있는 글의 Article.image 는 그 사진", () => {
    for (const slug of Object.keys(LEARN_IMAGES)) {
      const page = getLearnPage(slug)!;
      expect(buildLearnArticle(page).image).toBe(`${SITE_URL}${LEARN_IMAGES[slug].src}`);
    }
  });
  it("허브 CollectionPage.image", () => {
    expect(buildLearnHub(LEARN_PAGES).image).toBe(`${SITE_URL}${LEARN_HUB_IMAGE.src}`);
  });
});

describe("홈 '이름에 다 적어 두었습니다' — 낱말마다 해설로 잇는다", () => {
  const src = readFileSync(join(root, "components/WhyBand.tsx"), "utf8");
  it("A2·Jersey·Hay Milk 는 각 해설, Fresh 는 /faq", () => {
    expect(src).toMatch(/word:\s*"A2"[^}]*href:\s*"\/learn\/a2-milk"/);
    expect(src).toMatch(/word:\s*"Jersey"[^}]*href:\s*"\/learn\/jersey-milk"/);
    expect(src).toMatch(/word:\s*"Hay Milk"[^}]*href:\s*"\/learn\/hay-milk"/);
    expect(src).toMatch(/word:\s*"Fresh"[^}]*href:\s*"\/faq"/);
  });
  it("링크 대상 해설 글이 실제로 있다", () => {
    for (const slug of ["a2-milk", "jersey-milk", "hay-milk"]) expect(LEARN_SLUGS).toContain(slug);
  });
});
