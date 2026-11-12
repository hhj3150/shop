// robots.txt 본문을 만든다(app/robots.txt/route.ts 가 그대로 내보낸다).
//
//   [왜 라우트로 직접 쓰나] Next 의 app/robots.ts(MetadataRoute.Robots)는 주석 줄을 낼 수 없다.
//     다음(Daum) 웹마스터도구 소유확인은 robots.txt 의 주석 한 줄('#DaumWebMasterTool:…')로 한다.
//   [막는 것] /admin·/api 만 수집 자체를 막는다. 로그인·결제·주문·마이페이지는 막지 않고 각 layout 의
//     noindex 로 뺀다 — robots.txt 로 막으면 크롤러가 noindex 를 읽지 못해 주소만 색인될 수 있다
//     (https://developers.google.com/search/docs/crawling-indexing/block-indexing).
//   [AI 크롤러] 인용되기를 원하는 브랜드다 → 검색·답변용과 학습용 모두 허용한다. '*' 와 같은 규칙이지만
//     이름을 적어 의도를 분명히 한다. 특정 이름 그룹에 걸린 봇은 '*' 그룹을 보지 않으므로 Disallow 를
//     그룹마다 반복한다(RFC 9309).
//   ASCII 만 쓴다(일부 크롤러가 charset 을 무시한다).

export const ROBOTS_DISALLOW = ["/admin", "/api"] as const;

/** 답변·검색에 쓰는 봇 — 막으면 ChatGPT 검색·Claude·Perplexity 답변의 출처에서 빠진다. */
export const AI_ANSWER_BOTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "DuckAssistBot",
  "MistralAI-User",
] as const;

/** 모델 학습용 봇 — 브랜드가 모델 지식에 쌓이도록 허용을 유지한다(막아도 검색 순위와는 무관). */
export const AI_TRAINING_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "Amazonbot",
  "CCBot",
] as const;

/** 'hash:code' 또는 '#DaumWebMasterTool:hash:code' 를 받아 정확한 주석 줄로. 비면 null. */
export function daumVerificationLine(raw: string | undefined): string | null {
  const v = raw?.trim().replace(/^#?DaumWebMasterTool:/, "");
  if (!v) return null;
  if (!/^[0-9a-zA-Z]+:[0-9a-zA-Z]+$/.test(v)) return null; // 형식이 다르면 내보내지 않는다
  return `#DaumWebMasterTool:${v}`;
}

export function buildRobotsTxt(opts: { siteUrl: string; daumVerification?: string }): string {
  const group = (agents: readonly string[]) => [
    ...agents.map((a) => `User-agent: ${a}`),
    "Allow: /",
    ...ROBOTS_DISALLOW.map((d) => `Disallow: ${d}`),
  ];
  const daum = daumVerificationLine(opts.daumVerification);
  const lines = [
    ...group(["*"]),
    "",
    "# AI answer / search agents - allowed (we want to be cited)",
    ...group(AI_ANSWER_BOTS),
    "",
    "# AI training crawlers - allowed",
    ...group(AI_TRAINING_BOTS),
    "",
    `Sitemap: ${opts.siteUrl}/sitemap.xml`,
    ...(daum ? ["", daum] : []),
  ];
  return lines.join("\n") + "\n";
}
