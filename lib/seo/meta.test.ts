import { describe, it, expect } from "vitest";
import {
  pageMetadata,
  privateMetadata,
  searchVerification,
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  TITLE_SUFFIX,
} from "./meta";

type OG = { siteName?: string; url?: string; title?: string; locale?: string; images?: unknown };

describe("pageMetadata — 공유 카드가 페이지마다 '완전한 모양'", () => {
  const m = pageMetadata({ title: "목장 이야기", description: "설명", path: "/story" });
  const og = m.openGraph as OG;

  it("canonical 과 og:url 이 같은 경로", () => {
    expect(m.alternates?.canonical).toBe("/story");
    expect(og.url).toBe("/story");
  });

  it("사이트명·로케일·기본 이미지를 잃지 않는다(얕은 병합 대비)", () => {
    expect(og.siteName).toBe(SITE_NAME);
    expect(og.locale).toBe("ko_KR");
    expect(og.images).toEqual([DEFAULT_OG_IMAGE]);
  });

  it("og 제목은 접미사까지 붙은 전체 제목, 문서 제목은 템플릿이 붙인다", () => {
    expect(og.title).toBe(`목장 이야기${TITLE_SUFFIX}`);
    expect(m.title).toBe("목장 이야기");
  });

  it("absoluteTitle 이면 템플릿을 쓰지 않는다", () => {
    const h = pageMetadata({ title: "홈 제목", description: "d", path: "/", absoluteTitle: true });
    expect(h.title).toEqual({ absolute: "홈 제목" });
    expect((h.openGraph as OG).title).toBe("홈 제목");
  });

  it("ogImage:null 이면 images 키 자체가 없다 — 같은 폴더 opengraph-image 파일이 쓰이게", () => {
    const p = pageMetadata({ title: "t", description: "d", path: "/products/x", ogImage: null });
    expect("images" in (p.openGraph as object)).toBe(false);
    expect("images" in (p.twitter as object)).toBe(false);
  });
});

describe("privateMetadata", () => {
  it("noindex·nofollow", () => {
    expect(privateMetadata("로그인").robots).toEqual({ index: false, follow: false });
  });
});

describe("searchVerification — 환경변수로만", () => {
  it("아무 값도 없으면 태그 없음", () => {
    expect(searchVerification({})).toBeUndefined();
    expect(searchVerification({ GOOGLE_SITE_VERIFICATION: "  " })).toBeUndefined();
  });
  it("구글·네이버·Bing 값을 각각의 메타 이름으로", () => {
    expect(
      searchVerification({
        GOOGLE_SITE_VERIFICATION: "g1",
        NAVER_SITE_VERIFICATION: "n1",
        BING_SITE_VERIFICATION: "b1",
      })
    ).toEqual({ google: "g1", other: { "naver-site-verification": "n1", "msvalidate.01": "b1" } });
  });
  it("일부만 있어도 그 태그만", () => {
    expect(searchVerification({ BING_SITE_VERIFICATION: "b1" })).toEqual({
      other: { "msvalidate.01": "b1" },
    });
  });
});
