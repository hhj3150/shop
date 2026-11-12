import { describe, it, expect } from "vitest";
import { DEFAULT_OG_IMAGE, PUBLIC_ROBOTS } from "@/lib/seo/meta";
import { newsMetadata, ogCoverUrl, type NewsMetaRow } from "./news-meta";

const ID = "0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b";
const JPG = "https://abc.supabase.co/storage/v1/object/public/news/a1.JPG";

const row = (over: Partial<NewsMetaRow> = {}): NewsMetaRow => ({
  id: ID,
  title: "첫 풀베기를 마쳤습니다",
  body: "올해 첫 풀을 베어 건조장에 넣었습니다. ".repeat(10),
  cover_url: JPG,
  created_at: "2026-11-11T15:30:00+00:00",
  updated_at: "2026-11-12T03:00:00+00:00",
  ...over,
});

// Metadata 의 openGraph·twitter 는 유니온 타입이라 테스트에서는 평문 객체로 읽는다.
type Loose = Record<string, unknown>;
const og = (m: ReturnType<typeof newsMetadata>) => m.openGraph as Loose;
const tw = (m: ReturnType<typeof newsMetadata>) => m.twitter as Loose;

describe("공유 카드 표지 — https JPG/PNG 만", () => {
  it("허용", () => {
    expect(ogCoverUrl(JPG)).toBe(JPG);
    expect(ogCoverUrl("https://x.supabase.co/a/b.png?v=2")).toBe("https://x.supabase.co/a/b.png?v=2");
    expect(ogCoverUrl("https://x.supabase.co/a/b.jpeg")).toBe("https://x.supabase.co/a/b.jpeg");
  });
  it("거부 → 기본 이미지", () => {
    for (const bad of [
      null,
      "",
      "/news/a.jpg", // 상대주소
      "http://x.supabase.co/a.jpg", // http
      "https://x.supabase.co/a.webp", // 카카오톡이 못 읽는다
      "https://x.supabase.co/a.gif",
      "https://x.supabase.co/a.jpg.webp",
      "not a url",
    ]) {
      expect(ogCoverUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("소식 페이지 메타데이터", () => {
  it("제목 = 글 제목, 설명 = 100자 안팎 발췌, 대표주소 = /story/news/<id>, 공개 robots", () => {
    const m = newsMetadata(row());
    expect(m.title).toBe("첫 풀베기를 마쳤습니다");
    expect(typeof m.description).toBe("string");
    const d = m.description as string;
    expect(Array.from(d).length).toBeLessThanOrEqual(101);
    expect(d.startsWith("올해 첫 풀을 베어")).toBe(true);
    expect(m.alternates?.canonical).toBe(`/story/news/${ID}`);
    expect(m.robots).toEqual(PUBLIC_ROBOTS);
  });

  it("공유 카드: article 형식·게시/수정 시각·사이트명·대표주소", () => {
    const o = og(newsMetadata(row()));
    expect(o.type).toBe("article");
    expect(o.publishedTime).toBe("2026-11-11T15:30:00.000Z");
    expect(o.modifiedTime).toBe("2026-11-12T03:00:00.000Z");
    expect(o.siteName).toBe("송영신목장");
    expect(o.locale).toBe("ko_KR");
    expect(o.url).toBe(`/story/news/${ID}`);
    expect(o.title).toBe("첫 풀베기를 마쳤습니다 · 송영신목장");
  });

  it("JPG 표지면 공유 이미지 = 표지(공유 카드·트위터 모두)", () => {
    const m = newsMetadata(row());
    expect(og(m).images).toEqual([{ url: JPG, alt: "첫 풀베기를 마쳤습니다" }]);
    expect(tw(m).images).toEqual([{ url: JPG, alt: "첫 풀베기를 마쳤습니다" }]);
    expect(tw(m).card).toBe("summary_large_image");
  });

  it("WEBP 표지·표지 없음이면 기본 공유 이미지(1200×630 JPG)", () => {
    for (const cover of ["https://x.supabase.co/a.webp", null]) {
      const m = newsMetadata(row({ cover_url: cover }));
      expect(og(m).images).toEqual([DEFAULT_OG_IMAGE]);
      expect(tw(m).images).toEqual([{ url: DEFAULT_OG_IMAGE.url, alt: DEFAULT_OG_IMAGE.alt }]);
    }
  });

  it("글마다 설명이 다르다(네이버: 중복 설명 불이익)", () => {
    const a = newsMetadata(row()).description;
    const b = newsMetadata(row({ body: "겨울 사료 준비를 시작했습니다." })).description;
    expect(a).not.toBe(b);
  });
});
