// 오프라인 판매처(백화점) — 2026-11-13 회장님 확인. 홈·FAQ·llms·고객 도우미가 같은 명단을 말하는지.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OFFLINE_STORES, offlineStoresSentence, OFFLINE_PRODUCTS_LABEL } from "@/lib/site";
import { moreFaqItems } from "@/lib/seo/faq";
import { buildLlmsTxt } from "@/lib/seo/llms";
import { activeCertifications } from "@/lib/certifications";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";

const certs = activeCertifications("2026-11-13");

describe("백화점 판매처", () => {
  it("다섯 매장(갤러리아 명품관, 현대 압구정본점·목동점·판교점·무역센터점) — 광교는 없다", () => {
    expect(OFFLINE_STORES.map((s) => `${s.group} ${s.name}`)).toEqual([
      "갤러리아백화점 명품관",
      "현대백화점 압구정본점",
      "현대백화점 목동점",
      "현대백화점 판교점",
      "현대백화점 무역센터점",
    ]);
    expect(JSON.stringify(OFFLINE_STORES)).not.toMatch(/광교/);
  });
  it("한 줄 문장", () => {
    expect(offlineStoresSentence()).toBe("갤러리아 명품관(압구정), 현대백화점 압구정본점·목동점·판교점·무역센터점");
  });
  const surfaces: [string, string][] = [
    ["FAQ 구입처", moreFaqItems(certs).find((f) => f.question.includes("어디서 살 수"))!.answer],
    ["llms.txt", buildLlmsTxt({ certifications: certs, cardPayment: false })],
    ["고객 도우미", buildCustomerSystemPrompt()],
  ];
  for (const [where, t] of surfaces) {
    it(`${where} 가 같은 명단·품목을 말한다`, () => {
      expect(t).toContain(offlineStoresSentence());
      expect(t).toContain(OFFLINE_PRODUCTS_LABEL);
      expect(t).not.toMatch(/광교/);
    });
  }
  it("홈 '직접 찾아오시는 분께'는 같은 명단(OFFLINE_STORES)을 그린다", () => {
    const src = readFileSync(join(__dirname, "..", "components/VisitStore.tsx"), "utf8");
    expect(src).toMatch(/OFFLINE_STORES\.reduce/);
    expect(src).not.toMatch(/두 곳에서도/);
  });
});
