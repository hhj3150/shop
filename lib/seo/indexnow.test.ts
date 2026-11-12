import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  INDEXNOW_KEY,
  INDEXNOW_ENDPOINT,
  parseSitemap,
  recentUrls,
  urlsChangedOn,
  indexNowPayload,
} from "./indexnow";

const root = join(__dirname, "..", "..");
const SITE = "https://shop.a2jerseymilk.com";

describe("IndexNow 키", () => {
  it("규격(8–128자, 영숫자·하이픈)", () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-zA-Z0-9-]{8,128}$/);
  });
  it("public/<키>.txt 가 있고 내용이 키와 같다 — 없으면 엔진이 소유를 확인하지 못한다", () => {
    const f = join(root, "public", `${INDEXNOW_KEY}.txt`);
    expect(existsSync(f)).toBe(true);
    expect(readFileSync(f, "utf8").trim()).toBe(INDEXNOW_KEY);
  });
});

describe("parseSitemap / recentUrls", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url>
<loc>${SITE}</loc>
<lastmod>2026-11-11</lastmod>
</url>
<url>
<loc>${SITE}/products/milk-180</loc>
<image:image>
<image:loc>${SITE}/products/milk-180-bottle.webp</image:loc>
</image:image>
<lastmod>2026-11-12</lastmod>
</url>
<url>
<loc>${SITE}/terms</loc>
</url>
</urlset>`;

  it("주소와 수정일을 뽑고, 이미지 주소는 섞지 않는다", () => {
    const e = parseSitemap(xml);
    expect(e.map((x) => x.loc)).toEqual([SITE, `${SITE}/products/milk-180`, `${SITE}/terms`]);
    expect(e[1].lastmod).toBe("2026-11-12");
    expect(e[2].lastmod).toBeUndefined();
  });

  it("기준일 이후에 바뀐 주소만 고른다(수정일 없는 주소 제외)", () => {
    expect(recentUrls(parseSitemap(xml), "2026-11-12")).toEqual([`${SITE}/products/milk-180`]);
    expect(recentUrls(parseSitemap(xml), "2026-11-01")).toHaveLength(2);
  });
});

describe("매일 예약 제출 — 그날 바뀐 주소만 한 번", () => {
  const entries = [
    { loc: `${SITE}/a`, lastmod: "2026-11-11" },
    { loc: `${SITE}/b`, lastmod: "2026-11-12" },
    { loc: `${SITE}/c` },
  ];
  it("lastmod 가 정확히 그날인 주소만 — 이틀 연속 같은 주소를 보내지 않는다", () => {
    expect(urlsChangedOn(entries, "2026-11-12")).toEqual([`${SITE}/b`]);
    expect(urlsChangedOn(entries, "2026-11-13")).toEqual([]);
  });
  it("엔드포인트는 하나(받은 엔진이 참여 엔진 모두에 공유 — 여러 곳에 보내면 중복 수신)", () => {
    expect(INDEXNOW_ENDPOINT).toBe("https://api.indexnow.org/indexnow");
  });
});

describe("indexNowPayload", () => {
  it("호스트·키·키 위치, 다른 호스트 주소와 중복은 뺀다", () => {
    const p = indexNowPayload(SITE, [`${SITE}/a`, `${SITE}/a`, "https://evil.example/x"]);
    expect(p.host).toBe("shop.a2jerseymilk.com");
    expect(p.key).toBe(INDEXNOW_KEY);
    expect(p.keyLocation).toBe(`${SITE}/${INDEXNOW_KEY}.txt`);
    expect(p.urlList).toEqual([`${SITE}/a`]);
  });
});
