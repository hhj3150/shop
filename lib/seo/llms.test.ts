import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms";
import { FAQ_ITEMS } from "./faq";
import { PUBLIC_PRODUCTS, PRODUCTS, SUB_TOTAL_CAP, SUB_DAY_CAP, formatWon } from "@/lib/products";
import { CERTIFICATIONS, activeCertifications } from "@/lib/certifications";
import { SITE_URL, BUSINESS } from "@/lib/site";

const root = join(__dirname, "..", "..");
const input = { certifications: activeCertifications("2026-11-12"), cardPayment: false };
const txt = buildLlmsTxt(input);
const full = buildLlmsFullTxt(input);

describe("llms.txt — 형식(llmstxt.org)", () => {
  it("H1 으로 시작하고 바로 요약 인용(>)이 온다", () => {
    const lines = txt.split("\n");
    expect(lines[0]).toMatch(/^# /);
    expect(lines[2]).toMatch(/^> /);
  });
  it("Optional 섹션이 마지막 H2", () => {
    const h2 = txt.split("\n").filter((l) => l.startsWith("## "));
    expect(h2.at(-1)).toBe("## Optional");
  });
  it("public/llms.txt 가 없다 — 있으면 이 라우트를 조용히 가린다", () => {
    expect(existsSync(join(root, "public/llms.txt"))).toBe(false);
  });
});

describe("llms.txt — 사실은 SSOT 에서", () => {
  it("공개 제품마다 주소와 정가가 있고, 미공개 제품은 없다", () => {
    for (const p of PUBLIC_PRODUCTS) {
      expect(txt).toContain(`${SITE_URL}/products/${p.id}`);
      expect(txt).toContain(formatWon(p.price));
    }
    for (const p of PRODUCTS.filter((x) => x.unpublished)) {
      expect(txt).not.toContain(`/products/${p.id}`);
    }
  });
  it("정원·주소·전화가 SSOT 값", () => {
    expect(txt).toContain(`총 ${SUB_TOTAL_CAP}명`);
    expect(txt).toContain(`요일별 ${SUB_DAY_CAP}명`);
    expect(txt).toContain(BUSINESS.address);
    expect(txt).toContain(BUSINESS.tel);
  });
  it("유효 인증만 — 만료된 인증 번호는 없다", () => {
    for (const c of input.certifications) expect(txt).toContain(c.number);
    for (const c of CERTIFICATIONS.filter((x) => x.validUntil && x.validUntil < "2026-11-12")) {
      expect(txt).not.toContain(c.number);
    }
  });
  it("결제 수단 안내가 실제 설정을 따른다", () => {
    expect(txt).not.toContain("카드");
    expect(buildLlmsTxt({ ...input, cardPayment: true })).toContain("카드·간편결제");
  });
  it("근거가 SSOT 에 없는 '하루 500리터'를 AI 에 넘기지 않는다", () => {
    expect(full).not.toMatch(/500\s*리터|500L/);
  });
});

describe("llms-full.txt", () => {
  it("요약판 전체 + 모든 FAQ 문답 + 제품 표시사항", () => {
    expect(full.startsWith(txt.trimEnd())).toBe(true);
    for (const f of FAQ_ITEMS) expect(full).toContain(f.question);
    for (const p of PUBLIC_PRODUCTS) expect(full).toContain(p.label.ingredients);
  });
});
