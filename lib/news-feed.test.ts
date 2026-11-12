// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { SITE_URL } from "@/lib/site";
import {
  RSS_DESCRIPTION,
  RSS_MAX_ITEMS,
  RSS_TITLE,
  RSS_URL,
  bodyToHtml,
  buildNewsLlmsSection,
  buildNewsRss,
  escapeXml,
  isNewsId,
  newsDateLabel,
  newsExcerpt,
  newsPath,
  newsSitemapEntries,
  newsUrl,
  rfc822,
  safeYoutubeId,
  toIsoOrNull,
  youtubeEmbedUrl,
  type NewsFeedRow,
} from "./news-feed";

const ID1 = "0b6f1c2a-3d4e-4f50-8a1b-2c3d4e5f6a7b";
const ID2 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

function row(over: Partial<NewsFeedRow> = {}): NewsFeedRow {
  return {
    id: ID1,
    title: "  첫 풀베기를 마쳤습니다 ",
    body: "올해 첫 풀을 베어 건조장에 넣었습니다.\n\n날씨가 좋아 사흘 만에 말렸습니다.",
    created_at: "2026-11-11T15:30:00+00:00", // KST 2026-11-12 00:30
    updated_at: "2026-11-12T03:00:00.123456+00:00",
    ...over,
  };
}

const parseXml = (xml: string) => {
  // jsdom 의 XML 파서 — 올바른 XML 이 아니면 <parsererror> 를 낸다.
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.getElementsByTagName("parsererror").length, xml.slice(0, 400)).toBe(0);
  return doc;
};

describe("고유 주소", () => {
  it("uuid 만 소식 id 로 받는다", () => {
    expect(isNewsId(ID1)).toBe(true);
    expect(isNewsId(ID1.toUpperCase())).toBe(true);
    for (const bad of ["", "1", "abc", `${ID1}x`, "../admin", "0b6f1c2a-3d4e-4f50-8a1b"]) {
      expect(isNewsId(bad), bad).toBe(false);
    }
  });

  it("경로·절대주소", () => {
    expect(newsPath(ID1)).toBe(`/story/news/${ID1}`);
    expect(newsUrl(ID1)).toBe(`${SITE_URL}/story/news/${ID1}`);
    expect(newsPath("a b/c")).toBe("/story/news/a%20b%2Fc"); // 경로를 벗어나지 못한다
    expect(RSS_URL).toBe(`${SITE_URL}/rss.xml`);
  });
});

describe("날짜", () => {
  it("화면 날짜는 KST 달력 — UTC 전날 15시 30분은 KST 다음 날", () => {
    expect(newsDateLabel("2026-11-11T15:30:00+00:00")).toBe("2026년 11월 12일");
    expect(newsDateLabel("2026-01-05T00:00:00Z")).toBe("2026년 1월 5일");
    expect(newsDateLabel("not a date")).toBe("");
  });

  it("RFC 822 pubDate", () => {
    expect(rfc822("2026-11-12T06:00:00Z")).toBe("Thu, 12 Nov 2026 06:00:00 GMT");
    expect(rfc822("2026-11-11T15:30:00+00:00")).toBe("Wed, 11 Nov 2026 15:30:00 GMT");
    expect(rfc822("")).toBeNull();
    expect(rfc822("garbage")).toBeNull();
  });

  it("ISO 정규화(Supabase 의 마이크로초·+00:00 → Z)", () => {
    expect(toIsoOrNull("2026-11-12T03:00:00.123456+00:00")).toBe("2026-11-12T03:00:00.123Z");
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull("x")).toBeNull();
  });
});

describe("발췌(메타 설명)", () => {
  it("짧으면 그대로, 줄바꿈은 한 줄로", () => {
    expect(newsExcerpt("가나다\n\n라마바")).toBe("가나다 라마바");
  });

  it("길면 100자 안에서 어절 경계로 자르고 '…'", () => {
    const body = "목장에서 전하는 소식입니다 ".repeat(20);
    const ex = newsExcerpt(body);
    expect(ex.endsWith("…")).toBe(true);
    expect(Array.from(ex).length).toBeLessThanOrEqual(101);
    expect(ex).not.toMatch(/\s…$/);
    // 어절 중간에서 끊지 않는다
    expect(ex.replace(/…$/, "").split(" ").every((w) => "목장에서 전하는 소식입니다".split(" ").includes(w))).toBe(true);
  });

  it("공백 없는 긴 글은 정확히 max 글자에서 자른다", () => {
    const ex = newsExcerpt("가".repeat(300), 100);
    expect(ex).toBe(`${"가".repeat(100)}…`);
  });

  it("이모지(서로게이트 쌍)를 반으로 쪼개지 않는다", () => {
    const ex = newsExcerpt("🐄".repeat(150), 10);
    expect(ex).toBe(`${"🐄".repeat(10)}…`);
  });
});

describe("XML 이스케이프", () => {
  it("특수문자 다섯 가지", () => {
    expect(escapeXml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;"
    );
  });

  it("XML 1.0 에 쓸 수 없는 제어문자·짝 없는 서로게이트를 지운다(탭·줄바꿈은 남긴다)", () => {
    expect(escapeXml("a\u0000b\u0008c\u000Bd\u001Fe\tf\ng\rh")).toBe("abcde\tf\ng\rh");
    expect(escapeXml("x\uD800y")).toBe("xy");
    expect(escapeXml("x\uDC00y")).toBe("xy");
    expect(escapeXml("🐄")).toBe("🐄");
  });

  it("본문 HTML 조각 — 문단은 <p>, 문단 안 줄바꿈은 <br>, 사용자 HTML 은 글자로", () => {
    expect(bodyToHtml("첫 줄\n둘째 줄\n\n<b>굵게</b> & 끝")).toBe(
      "<p>첫 줄<br>둘째 줄</p><p>&lt;b&gt;굵게&lt;/b&gt; &amp; 끝</p>"
    );
  });
});

describe("유튜브", () => {
  it("11자리 id 만, 개인정보 보호 모드 주소", () => {
    expect(safeYoutubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(safeYoutubeId("dQw4w9WgXcQ\"><script>")).toBeNull();
    expect(safeYoutubeId(null)).toBeNull();
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });
});

describe("RSS 2.0", () => {
  it("글이 없어도 올바른 피드(item 0개, lastBuildDate 없음)", () => {
    const xml = buildNewsRss([]);
    const doc = parseXml(xml);
    expect(doc.documentElement.tagName).toBe("rss");
    expect(doc.documentElement.getAttribute("version")).toBe("2.0");
    const ch = doc.getElementsByTagName("channel")[0];
    expect(ch.getElementsByTagName("title")[0].textContent).toBe(RSS_TITLE);
    expect(ch.getElementsByTagName("link")[0].textContent).toBe(`${SITE_URL}/story`);
    expect(ch.getElementsByTagName("language")[0].textContent).toBe("ko");
    expect(ch.getElementsByTagName("description")[0].textContent).toBe(RSS_DESCRIPTION);
    expect(doc.getElementsByTagName("item").length).toBe(0);
    expect(doc.getElementsByTagName("lastBuildDate").length).toBe(0);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it("item: 제목·고유주소 link·guid(isPermaLink)·pubDate·본문 전체", () => {
    const doc = parseXml(buildNewsRss([row()]));
    const item = doc.getElementsByTagName("item")[0];
    const text = (tag: string) => item.getElementsByTagName(tag)[0]?.textContent;
    expect(text("title")).toBe("첫 풀베기를 마쳤습니다");
    expect(text("link")).toBe(newsUrl(ID1));
    expect(text("guid")).toBe(newsUrl(ID1));
    expect(item.getElementsByTagName("guid")[0].getAttribute("isPermaLink")).toBe("true");
    expect(text("pubDate")).toBe("Wed, 11 Nov 2026 15:30:00 GMT");
    // description 은 이스케이프된 HTML — 풀면 본문 전체가 문단으로 나온다(네이버: 본문 전체).
    expect(text("description")).toBe(
      "<p>올해 첫 풀을 베어 건조장에 넣었습니다.</p><p>날씨가 좋아 사흘 만에 말렸습니다.</p>"
    );
    expect(doc.getElementsByTagName("lastBuildDate")[0].textContent).toBe("Thu, 12 Nov 2026 03:00:00 GMT");
  });

  it("제목·본문의 XML/HTML 특수문자·제어문자가 피드를 깨뜨리지 않는다", () => {
    const evil = row({
      title: `]]></title><script>alert(1)</script> & "따옴표" 'x'`,
      body: `</description><x>\u0001 & <img src=x onerror=alert(1)>`,
    });
    const xml = buildNewsRss([evil]);
    const doc = parseXml(xml);
    expect(doc.getElementsByTagName("script").length).toBe(0);
    expect(doc.getElementsByTagName("x").length).toBe(0);
    const item = doc.getElementsByTagName("item")[0];
    expect(item.getElementsByTagName("title")[0].textContent).toBe(
      `]]></title><script>alert(1)</script> & "따옴표" 'x'`
    );
    expect(item.getElementsByTagName("description")[0].textContent).toBe(
      "<p>&lt;/description&gt;&lt;x&gt; &amp; &lt;img src=x onerror=alert(1)&gt;</p>"
    );
  });

  it("피드 안의 모든 URL 이 사이트 도메인이다(네이버 검증) — 표지 사진·유튜브 주소를 넣지 않는다", () => {
    const xml = buildNewsRss([
      { ...row(), ...{ cover_url: "https://x.supabase.co/storage/v1/object/public/news/a.jpg", youtube_id: "dQw4w9WgXcQ" } },
    ]);
    const urls = [...xml.matchAll(/https?:\/\/[^\s"<&]+/g)].map((m) => m[0]);
    for (const u of urls) {
      if (u === "http://www.w3.org/2005/Atom") continue; // 네임스페이스 식별자(주소 아님)
      expect(u.startsWith(SITE_URL), u).toBe(true);
    }
    expect(xml).not.toContain("supabase.co");
    expect(xml).not.toContain("youtube");
  });

  it("최신 글 먼저, 최대 RSS_MAX_ITEMS 개, 잘못된 id·빈 제목은 뺀다", () => {
    const many: NewsFeedRow[] = Array.from({ length: RSS_MAX_ITEMS + 5 }, (_, i) =>
      row({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        title: `소식 ${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString(),
      })
    );
    const doc = parseXml(buildNewsRss([...many, row({ id: "bad" }), row({ id: ID2, title: "   " })]));
    const titles = [...doc.getElementsByTagName("item")].map((it) => it.getElementsByTagName("title")[0].textContent);
    expect(titles.length).toBe(RSS_MAX_ITEMS);
    expect(titles[0]).toBe(`소식 ${RSS_MAX_ITEMS + 4}`);
  });

  it("같은 데이터면 같은 피드(지금 시각을 쓰지 않는다)", () => {
    expect(buildNewsRss([row()])).toBe(buildNewsRss([row()]));
  });
});

describe("사이트맵 항목", () => {
  it("주소 + KST 수정일(YYYY-MM-DD), XML 특수문자 없음", () => {
    const entries = newsSitemapEntries([
      row(),
      row({ id: ID2, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T16:00:00Z" }),
      row({ id: "not-uuid" }),
    ]);
    expect(entries).toEqual([
      { url: newsUrl(ID1), lastModified: "2026-11-12" },
      { url: newsUrl(ID2), lastModified: "2026-11-03" },
    ]);
    for (const e of entries) expect(e.url).not.toMatch(/[&<>"]/);
  });
});

describe("llms.txt 절", () => {
  it("글이 없으면 빈 문자열(빈 H2 를 만들지 않는다)", () => {
    expect(buildNewsLlmsSection([])).toBe("");
  });

  it("H2 아래는 '- [제목](주소): 날짜 · 발췌' 줄만, 제목의 대괄호는 이스케이프", () => {
    const s = buildNewsLlmsSection([row({ title: "[공지] 휴무 안내" })]);
    const [h2, blank, ...lines] = s.split("\n");
    expect(h2).toBe("## 목장 소식");
    expect(blank).toBe("");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `- [〔공지〕 휴무 안내](${newsUrl(ID1)}): 2026-11-12 · 올해 첫 풀을 베어 건조장에 넣었습니다. 날씨가 좋아 사흘 만에 말렸습니다.`
    );
    for (const l of lines) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\)(: .+)?$/);
  });
});

// 이 파일이 직접 쓴 피드 문구(채널 제목·설명)도 브랜드 카피 가이드를 따른다(lib/seo/claims.test.ts 와 같은 기준).
describe("피드 고정 문구 — 금지 표현 없음", () => {
  const banned: RegExp[] = [
    /건초(?:로)?만|풀(?:로)?만|100%\s*건초|곡물\s*무급여/,
    /방목(?!\s*인증)/,
    /BCM|면역|장[-–]뇌|소화|속이\s*편|속\s*편한/,
    /grass[- ]?fed/i,
    /일반\s*우유|보다\s*(더|진하|건강|맛)/,
    /국내\s*최초|최고의|최상급|국내\s*유일|유일한/,
    /동물복지\s*우유|유기농/,
  ];
  for (const [k, v] of [
    ["RSS_TITLE", RSS_TITLE],
    ["RSS_DESCRIPTION", RSS_DESCRIPTION],
  ] as const) {
    it(k, () => {
      for (const re of banned) expect(v, `${k}: ${re}`).not.toMatch(re);
    });
  }
});
