// 오프라인 판매처(백화점) — 2026-11-13 회장님 확인. 홈·FAQ·llms·고객 도우미가 같은 명단을 말하는지.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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
    expect(offlineStoresSentence()).toBe("갤러리아 명품관 고메이494(압구정), 현대백화점 압구정본점·목동점·판교점·무역센터점");
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
  it("백화점 진열 사진 파일이 있고 설명이 붙어 있다", () => {
    const src = readFileSync(join(__dirname, "..", "components/VisitStore.tsx"), "utf8");
    expect(src).toMatch(/\/stores\/galleria-apgujeong\.webp/);
    expect(existsSync(join(__dirname, "..", "public/stores/galleria-apgujeong.webp"))).toBe(true);
    expect(src).toMatch(/alt="갤러리아 명품관[^"]+"/);
  });
  it("갤러리아 판매 위치는 확인된 '고메이494' — 층수 같은 미확인 정보는 없다", () => {
    const g = OFFLINE_STORES.find((s) => s.group === "갤러리아백화점")!;
    expect(g.spot).toBe("고메이494");
    expect(JSON.stringify(OFFLINE_STORES)).not.toMatch(/지하|[0-9]층|B1/);
    expect(buildLlmsTxt({ certifications: certs, cardPayment: false })).toMatch(/GOURMET 494/);
  });
  it("고메이494 사진 두 장(입구·진열대) 파일과 설명", () => {
    const src = readFileSync(join(__dirname, "..", "components/VisitStore.tsx"), "utf8");
    for (const f of ["galleria-gourmet494-entrance.webp", "galleria-gourmet494-shelf.webp"]) {
      expect(src).toContain(`/stores/${f}`);
      expect(existsSync(join(__dirname, "..", "public/stores", f)), f).toBe(true);
    }
    // 사진 설명은 보이는 것만 — 다른 브랜드 이름이나 손님 묘사를 쓰지 않는다.
    expect(src).not.toMatch(/the milk|lukt|손님들?이|사람들?이/i);
  });
});
