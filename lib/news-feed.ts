// 목장 소식(news) — 고유 주소·RSS·사이트맵·llms 에 쓰는 순수 함수. (React·Supabase 비의존, 단위 테스트 대상)
//
//   [왜] 소식은 예전에 /story 화면에서 브라우저가 직접 읽어 그렸다(components/NewsBand). 서버 HTML 에
//        소식이 없고 글마다 주소도 없어서, 검색·AI 가 목장 소식을 하나도 색인하지 못했다.
//        이제 글마다 /story/news/<id> 주소가 있고, 같은 데이터로 RSS(/rss.xml)·사이트맵 항목을 만든다.
//   ★ 날짜는 KST 달력으로 적는다(lib/kst.ts). 서버(Netlify)는 UTC 라 toLocaleDateString 을 그대로 쓰면
//     KST 자정~오전 9시 글이 전날로 찍히고, 서버 HTML 과 브라우저 화면의 날짜가 어긋난다.
//   ★ 네이버 서치어드바이저 RSS 검증(https://searchadvisor.naver.com/guide/request-feed, 2026-11 확인):
//     ① 피드 안의 모든 URL 은 소유확인한 사이트와 같은 도메인 ② item 이 1개 이상(글이 없으면 제출 불가)
//     ③ 10MB 미만 ④ 본문은 일부가 아니라 전체. → 표지 사진(supabase.co)·유튜브 주소는 피드에 넣지 않는다.
import { SITE_URL } from "@/lib/site";
import { kstYmd } from "@/lib/kst";
import { formatBody, formatTitle, toParagraphs, type NewsRow } from "@/lib/news";

/** 소식 고유 주소의 경로 앞부분. */
export const NEWS_PATH_PREFIX = "/story/news";

/** RSS 공개 주소(경로). 페이지 <link rel="alternate" type="application/rss+xml"> 가 가리킨다. */
export const RSS_PATH = "/rss.xml";
export const RSS_TITLE = "송영신목장 목장 소식";
export const RSS_DESCRIPTION =
  "경기도 안성 송영신목장이 직접 전하는 목장 소식입니다. A2 저지 젖소를 기르고 헤이밀크를 만드는 목장의 하루를 적습니다.";

/** RSS 에 넣는 최근 글 수 — 본문 전체를 담으므로 많이 넣지 않는다(네이버: 10MB 제한, 사이트맵 활용 권장). */
export const RSS_MAX_ITEMS = 50;

/** 메타 설명·구조화데이터 description 에 쓰는 발췌 길이(글자). */
export const EXCERPT_MAX = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** news.id 는 uuid 다. 모양이 다르면 DB 에 묻지 않고 '없음'으로 처리한다(uuid 형변환 오류 방지). */
export function isNewsId(id: string): boolean {
  return UUID_RE.test(id);
}

export function newsPath(id: string): string {
  return `${NEWS_PATH_PREFIX}/${encodeURIComponent(id)}`;
}

export function newsUrl(id: string): string {
  return `${SITE_URL}${newsPath(id)}`;
}

export const RSS_URL = `${SITE_URL}${RSS_PATH}`;

/** ISO 문자열 → 정규화한 ISO(UTC, 'Z'). 잘못된 값은 null. */
export function toIsoOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** RSS pubDate — RFC 822(RFC 1123) 형식, 예: "Thu, 12 Nov 2026 06:00:00 GMT". 잘못된 값은 null. */
export function rfc822(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toUTCString();
}

/** 화면 날짜 — KST 기준 "2026년 11월 12일". 서버·브라우저가 같은 글자를 낸다(하이드레이션 불일치 방지). */
export function newsDateLabel(iso: string): string {
  const ymd = kstYmd(iso);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

/**
 * 본문 발췌 — 메타 설명용. 서식(줄바꿈)을 한 줄로 펴고 max 글자에서 자른다.
 * 자르는 자리가 어절 중간이면 마지막 공백까지 물러난다(너무 많이 잃지 않는 범위에서). 잘랐으면 '…'.
 * 글자 수는 코드포인트 기준(이모지를 반으로 쪼개지 않는다).
 */
export function newsExcerpt(body: string, max = EXCERPT_MAX): string {
  const flat = formatBody(body).replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  let cut = chars.slice(0, max).join("");
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= cut.length * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s,.·…:;~\-–—]+$/u, "")}…`;
}

// XML 1.0 이 허용하지 않는 문자(제어문자·짝 없는 서로게이트·U+FFFE/FFFF). 남아 있으면 피드 전체가
//   '올바른 XML 이 아님'으로 거부된다 — 관리자 입력(복사·붙여넣기)에 섞여 들어올 수 있다.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** XML 텍스트·속성값 이스케이프(& < > " ') + XML 에 쓸 수 없는 문자 제거. */
export function escapeXml(s: string): string {
  return s
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** HTML 텍스트 이스케이프(RSS description 안의 HTML 조각용). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 본문 전체 → 문단 HTML(<p>…</p>, 문단 안 줄바꿈은 <br>). RSS 리더가 문단을 살려 보이게. */
export function bodyToHtml(body: string): string {
  return toParagraphs(body)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** 유튜브 11자리 id 만 허용(관리자 입력은 lib/news.ts youtubeId 로 정리되지만 한 번 더 확인). */
export function safeYoutubeId(id: string | null | undefined): string | null {
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** 개인정보 보호 모드(youtube-nocookie) 임베드 주소 — 재생 전에는 쿠키를 심지 않는다. */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

export type NewsFeedRow = Pick<NewsRow, "id" | "title" | "body" | "created_at" | "updated_at">;

/** 최신 글 먼저(created_at 내림차순). 원본 배열은 건드리지 않는다. */
function newestFirst<T extends NewsFeedRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}

function rssItem(r: NewsFeedRow): string {
  const url = escapeXml(newsUrl(r.id));
  const pub = rfc822(r.created_at);
  return [
    "<item>",
    `<title>${escapeXml(formatTitle(r.title))}</title>`,
    `<link>${url}</link>`,
    `<guid isPermaLink="true">${url}</guid>`,
    ...(pub ? [`<pubDate>${pub}</pubDate>`] : []),
    // 본문 전체(네이버 요구). HTML 조각을 XML 이스케이프해 넣는다(RSS 2.0 의 entity-encoded HTML).
    `<description>${escapeXml(bodyToHtml(r.body))}</description>`,
    "</item>",
  ].join("\n");
}

/**
 * RSS 2.0 피드. 글이 없어도 올바른 피드(item 0개)를 낸다 — 다만 네이버는 item 이 1개 이상이어야
 * 제출을 받는다(첫 소식을 게시한 뒤 제출).
 * lastBuildDate 는 '지금'이 아니라 가장 최근 수정일 — 같은 데이터면 같은 피드(결정적).
 */
export function buildNewsRss(rows: readonly NewsFeedRow[]): string {
  const items = newestFirst(rows.filter((r) => isNewsId(r.id) && formatTitle(r.title))).slice(
    0,
    RSS_MAX_ITEMS
  );
  const lastMod = items
    .map((r) => Date.parse(r.updated_at) || Date.parse(r.created_at) || 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const channel = [
    `<title>${escapeXml(RSS_TITLE)}</title>`,
    `<link>${escapeXml(`${SITE_URL}/story`)}</link>`,
    `<description>${escapeXml(RSS_DESCRIPTION)}</description>`,
    "<language>ko</language>",
    `<atom:link href="${escapeXml(RSS_URL)}" rel="self" type="application/rss+xml"/>`,
    ...(lastMod > 0 ? [`<lastBuildDate>${new Date(lastMod).toUTCString()}</lastBuildDate>`] : []),
    ...items.map(rssItem),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    ...channel,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

export type NewsSitemapEntry = { url: string; lastModified: string };

/**
 * sitemap.xml 항목 — 주소 + 마지막 수정일(KST YYYY-MM-DD, updated_at 기준).
 * lib/seo/sitemap.ts 규칙과 같다: 날짜는 실제 수정일, 이미지 항목 없음, 주소에 XML 특수문자 없음(uuid).
 */
export function newsSitemapEntries(rows: readonly NewsFeedRow[]): NewsSitemapEntry[] {
  return newestFirst(rows.filter((r) => isNewsId(r.id))).flatMap((r) => {
    const lastModified = kstYmd(r.updated_at) || kstYmd(r.created_at);
    return lastModified ? [{ url: newsUrl(r.id), lastModified }] : [];
  });
}

/** 마크다운 링크 텍스트 안의 대괄호·역슬래시를 이스케이프하고 한 줄로 편다. */
// 링크 글자 안의 대괄호는 〔 〕 로 바꾼다 — '\\]' 이스케이프는 llmstxt.org 참조 파서([^\]]+)가 못 읽는다.
function mdLinkText(s: string): string {
  return formatTitle(s).replace(/\[/g, "〔").replace(/\]/g, "〕");
}

/**
 * /llms.txt 에 덧붙일 '## 목장 소식' 절(llmstxt.org 형식: H2 아래는 '- [이름](주소): 메모' 줄만).
 * 글이 없으면 빈 문자열 — 빈 H2 를 만들지 않는다.
 */
export function buildNewsLlmsSection(rows: readonly NewsFeedRow[], max = 10): string {
  const items = newestFirst(rows.filter((r) => isNewsId(r.id) && formatTitle(r.title))).slice(0, max);
  if (items.length === 0) return "";
  const lines = items.map((r) => {
    const date = kstYmd(r.created_at);
    const excerpt = newsExcerpt(r.body, 80);
    const note = [date, excerpt].filter(Boolean).join(" · ");
    return `- [${mdLinkText(r.title)}](${newsUrl(r.id)})${note ? `: ${note}` : ""}`;
  });
  return ["## 목장 소식", "", ...lines].join("\n");
}
