import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LEARN_IMAGES, LEARN_HUB_IMAGE, LEARN_SECTION_IMAGES, learnSectionImage } from "./learn-images";
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

// WebP 크기(RIFF 헤더) — 선언한 width/height 가 실제 파일과 같은지(어긋나면 next/image 가 찌그러뜨린다)
function webpSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  expect(b.toString("ascii", 0, 4) + b.toString("ascii", 8, 12), `${path} 는 WebP 여야 한다`).toBe("RIFFWEBP");
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`알 수 없는 WebP 청크 ${chunk}: ${path}`);
}

// 사진 설명에 쓰면 안 되는 말 — 사료 사실(생풀 급여 없음), 방목(동물복지 인증서 '자유방목 기준 충족 여부: 부'),
//   사진으로 입증할 수 없는 환경 효능(탄소 흡수·메탄 등), 확인되지 않은 사실:
//   어미·새끼 관계(사진의 젖소가 그 송아지의 어미인지 모름), 작물 이름(인증 목장 글의 밭 — 회장님 확인 전).
//   ★ 작물이 확인되면 그 이름만 이 목록에서 빼고 사진 설명을 고친다.
const BANNED_IN_PHOTO_TEXT =
  /풀을\s*(뜯|먹)|풀과\s*건초|방목|메탄|탄소\S{0,2}\s*(흡수|저장|격리)|어미|새끼|호밀|라이그라스|귀리|보리|옥수수|수단그라스|알팔파|티모시/;

it("사진 설명 금지어 검사가 실제로 잡는다", () => {
  for (const bad of ["어미 소 곁의 송아지", "새끼 송아지", "호밀 싹", "이탈리안 라이그라스 밭", "방목하는 소", "탄소를 흡수하는 밭"]) {
    expect(bad).toMatch(BANNED_IN_PHOTO_TEXT);
  }
  for (const ok of ["저지 젖소와 송아지", "밭에 줄지어 돋아난 어린 싹", "헤이밀크"]) expect(ok).not.toMatch(BANNED_IN_PHOTO_TEXT);
});

const all = [...Object.entries(LEARN_IMAGES), ["(hub)", LEARN_HUB_IMAGE] as const];

describe("해설 사진 — 파일·공유 카드·설명", () => {
  for (const [slug, img] of all) {
    it(`${slug}`, () => {
      if (slug !== "(hub)") expect(LEARN_SLUGS, "있는 해설 글에만 사진을 단다").toContain(slug);
      expect(existsSync(pub(img.src)), img.src).toBe(true);
      expect(img.src).toMatch(/\.webp$/);
      expect(img.width / img.height).toBeCloseTo(3 / 4, 2);
      expect(webpSize(pub(img.src)), "선언한 크기 = 실제 파일 크기").toEqual({ w: img.width, h: img.height });
      const og = jpegSize(pub(img.og));
      expect(og).toEqual({ w: 1200, h: 630 });
      expect(img.alt.trim().length).toBeGreaterThan(10);
      expect(`${img.alt} ${img.caption ?? ""}`).not.toMatch(BANNED_IN_PHOTO_TEXT);
    });
  }
});

describe("본문 소제목 사진", () => {
  const entries = Object.entries(LEARN_SECTION_IMAGES).flatMap(([slug, imgs]) =>
    imgs.map((img) => [slug, img] as const)
  );
  it("하나 이상 있다(인증 목장 — 저탄소)", () => {
    expect(learnSectionImage("certified-farm", "저탄소 축산물 인증은 무엇을 심사하나요?")).toBeDefined();
  });
  for (const [slug, img] of entries) {
    it(`${slug} · ${img.heading}`, () => {
      const page = getLearnPage(slug);
      expect(page, "있는 해설 글").toBeDefined();
      expect(
        page!.sections.map((s) => s.heading),
        "소제목이 글에 그대로 있어야 한다(고치면 사진도 같이 고친다)"
      ).toContain(img.heading);
      expect(existsSync(pub(img.src)), img.src).toBe(true);
      expect(webpSize(pub(img.src))).toEqual({ w: img.width, h: img.height });
      expect(img.width / img.height).toBeCloseTo(3 / 2, 2);
      expect(img.alt.trim().length).toBeGreaterThan(10);
      expect(`${img.alt} ${img.caption ?? ""}`).not.toMatch(BANNED_IN_PHOTO_TEXT);
    });
  }
  it("해설 화면이 소제목 사진을 그린다", () => {
    const src = readFileSync(join(root, "app/learn/[slug]/page.tsx"), "utf8");
    expect(src).toMatch(/learnSectionImage\(page\.slug,\s*s\.heading\)/);
    expect(src).toMatch(/alt=\{sectionImg\.alt\}/);
  });
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
