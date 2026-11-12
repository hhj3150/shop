import { describe, it, expect } from "vitest";
import {
  buildRobotsTxt,
  daumVerificationLine,
  AI_ANSWER_BOTS,
  AI_TRAINING_BOTS,
  ROBOTS_DISALLOW,
} from "./robots";

const SITE = "https://shop.a2jerseymilk.com";

// robots.txt 를 그룹별로 나눈다(빈 줄 구분, 주석 제외).
function groups(txt: string) {
  return txt
    .split(/\n\s*\n/)
    .map((b) => b.split("\n").filter((l) => l && !l.startsWith("#")))
    .filter((b) => b.some((l) => l.startsWith("User-agent:")));
}

describe("buildRobotsTxt", () => {
  const txt = buildRobotsTxt({ siteUrl: SITE });

  it("사이트맵 주소를 알린다", () => {
    expect(txt).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("모든 그룹이 같은 Disallow(/admin·/api)를 갖는다 — 이름 그룹은 '*' 를 보지 않는다", () => {
    const gs = groups(txt);
    expect(gs.length).toBe(3);
    for (const g of gs) {
      for (const d of ROBOTS_DISALLOW) expect(g).toContain(`Disallow: ${d}`);
      expect(g).toContain("Allow: /");
    }
  });

  it("로그인·결제·주문·마이페이지는 robots 로 막지 않는다(noindex 를 읽게)", () => {
    for (const p of ["/login", "/checkout", "/account", "/orders", "/forgot-password", "/reset-password"]) {
      expect(txt).not.toContain(`Disallow: ${p}`);
    }
  });

  it("AI 답변·학습 봇을 모두 이름으로 허용한다", () => {
    for (const b of [...AI_ANSWER_BOTS, ...AI_TRAINING_BOTS]) {
      expect(txt).toContain(`User-agent: ${b}`);
    }
  });

  it("ASCII 만 쓴다", () => {
    expect(/^[\x00-\x7F]*$/.test(txt)).toBe(true);
  });

  it("다음 인증값이 없으면 인증줄이 없다", () => {
    expect(txt).not.toContain("DaumWebMasterTool");
  });

  it("실제 다음 PIN 모양(64자리 16진수 : Base64 '=='·'+'·'/')도 그대로 낸다", () => {
    const pin = `${"de990a9b".repeat(8)}:7x7o+K9j/rwZAIo2A992FSMg==`;
    const t = buildRobotsTxt({ siteUrl: SITE, daumVerification: pin });
    expect(t.trimEnd().split("\n").at(-1)).toBe(`#DaumWebMasterTool:${pin}`);
  });

  it("다음 인증값이 있으면 정확한 형식의 주석 한 줄", () => {
    const withDaum = buildRobotsTxt({ siteUrl: SITE, daumVerification: "abc123:XyZ9" });
    expect(withDaum.trimEnd().split("\n").at(-1)).toBe("#DaumWebMasterTool:abc123:XyZ9");
  });
});

describe("daumVerificationLine", () => {
  it("접두어가 있어도 없어도 같은 줄", () => {
    expect(daumVerificationLine("#DaumWebMasterTool:aa:bb")).toBe("#DaumWebMasterTool:aa:bb");
    expect(daumVerificationLine("aa:bb")).toBe("#DaumWebMasterTool:aa:bb");
  });
  it("비었거나 형식이 다르면 null", () => {
    expect(daumVerificationLine(undefined)).toBeNull();
    expect(daumVerificationLine("  ")).toBeNull();
    expect(daumVerificationLine("bad value\nUser-agent: *")).toBeNull();
  });
});
