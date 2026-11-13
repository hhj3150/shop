// 헤이밀크 표기 — EU 전통특산물보증(TSG)·ARGE Heumilch 를 참고하되 '인증받은 것처럼' 읽히지 않게(2026-11-13).
//   근거: 위원회 시행규정 (EU) 2016/304(이름 'Heumilch/Haymilk' 등록·사양), 규정 (EU) 2024/1143 제68·70·71조
//   (사양을 지킨 제품만 이름·표시 사용, 설명 목적이라도 오인 금지), ARGE Heumilch(heumilch.com) 자료.
//   송영신목장은 '헤이밀크 방식을 따른다' — EU TSG 인증 제품이 아니고, 사양 세부 준수도 검증받지 않았다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAQ_ITEMS, moreFaqItems } from "./faq";
import { buildLlmsTxt, buildLlmsFullTxt } from "./llms";
import { getLearnPage } from "./learn";
import { activeCertifications } from "@/lib/certifications";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";
import { PRODUCTS } from "@/lib/products";

const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");
const certs = activeCertifications("2026-11-13");
const input = { certifications: certs, cardPayment: false };
const hay = getLearnPage("hay-milk")!;
const hayText = [hay.intro, ...hay.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");

const surfaces: [string, string][] = [
  ["FAQ", JSON.stringify([...FAQ_ITEMS, ...moreFaqItems(certs)])],
  ["llms.txt", buildLlmsTxt(input)],
  ["llms-full.txt", buildLlmsFullTxt(input)],
  ["고객 도우미", buildCustomerSystemPrompt()],
  ["/story Provenance", src("components/Provenance.tsx")],
  ["홈 WhyBand", src("components/WhyBand.tsx")],
  ["/learn/hay-milk", hayText],
  ["제품 문구", JSON.stringify(PRODUCTS.map((p) => p.story))],
];

describe("제도 이름은 '전통특산물보증(TSG)'", () => {
  for (const [where, t] of surfaces) {
    it(where, () => expect(t).not.toMatch(/전통특산물(?!보증)/));
  }
});

describe("TSG 를 말하는 곳에는 '인증 제품이 아니다'가 함께 있다", () => {
  for (const [where, t] of surfaces) {
    it(where, () => {
      if (!/TSG/.test(t)) return;
      // '인증 제품은 아닙니다'·'인증 제품이 아닙니다'·'인증을 받은 제품은 아닙니다' — 아니/아닙 모두.
      expect(t).toMatch(/TSG\)?\s*인증[^.。]*(아니|아닙)/);
    });
  }
  it("홈 'Hay Milk' 띠는 해설로 잇는다", () => {
    expect(src("components/WhyBand.tsx")).toMatch(/href:\s*"\/learn\/hay-milk"/);
  });
});

describe("사양을 '그대로' 지킨다고 하지 않는다(검증받지 않았다)", () => {
  it("제품 문구·카피 가이드", () => {
    expect(JSON.stringify(PRODUCTS.map((p) => p.story))).not.toMatch(/그대로\s*따릅니다|방식\s*그대로/);
    expect(src("docs/브랜드-카피-가이드.md")).not.toMatch(/그\s*방식\s*그대로/);
  });
});

describe("ARGE·EU 자료의 영양·효능·맛 주장을 옮겨 오지 않는다", () => {
  for (const [where, t] of surfaces) {
    it(where, () => {
      expect(t).not.toMatch(/오메가-?3[^.。]*(2배|두\s*배|많)|CLA|공액리놀레산/);
      expect(t).not.toMatch(/잡미가\s*적|사일리지를\s*먹이지\s*않아\s*맛/);
    });
  }
});

describe("/learn/hay-milk 출처·사실", () => {
  it("EU 사양의 원문은 EUR-Lex(영국판 legislation.gov.uk 아님)", () => {
    const urls = hay.sources.map((s) => s.url);
    expect(urls.some((u) => u.includes("CELEX:32016R0304"))).toBe(true);
    expect(urls.some((u) => u.includes("legislation.gov.uk"))).toBe(false);
  });
  it("ARGE 단체 규정(Heumilchregulativ)을 EU 사양이라 부르지 않는다", () => {
    expect(hayText).not.toMatch(/EU에\s*등록된[^.。]*Heumilchregulativ/);
  });
  it("사일리지·곤포 금지는 EU 사양의 규칙으로 말한다(목장 진술로 읽히지 않게)", () => {
    expect(hayText).toMatch(/EU\s*사양은\s*헤이밀크\s*농장에서\s*사일리지/);
  });
  it("GM 금지는 사료와 동물 모두", () => {
    expect(hayText).toMatch(/유전자변형\(GM\)으로\s*표시해야\s*하는\s*사료와\s*동물/);
  });
  it("검사 제도·단체 소개 소제목이 있고, 비인증 안내가 맨 끝이다", () => {
    const heads = hay.sections.map((s) => s.heading);
    expect(heads).toContain("EU 헤이밀크는 누가 검사하나요?");
    expect(heads).toContain("ARGE Heumilch는 어떤 단체인가요?");
    expect(heads[heads.length - 1]).toBe("송영신목장 우유는 EU 인증 헤이밀크인가요?");
  });
  it("사료 비율 수치(%)를 쓰지 않는다 — 카피 가이드(사료 수치 금지) 개정 전까지", () => {
    const feed = hay.sections.find((s) => s.heading.includes("무엇을 먹나요"))!;
    expect(feed.paragraphs.join(" ")).not.toMatch(/\d+\s*%/);
  });
});

// 2026-11-13 회장님 확인: 사일리지·헤일리지 같은 발효 조사료와 생풀은 먹이지 않는다(조사료는 건초, 곡물 등 보조사료는 먹임).
//   → 우리 목장 사료는 '건초를 중심으로'. '풀과 건초'는 EU 헤이밀크 방식(여름 생풀·겨울 건초)을 설명할 때만 쓴다.
describe("우리 목장 사료 표현 — '건초를 중심으로'(생풀 급여 없음)", () => {
  const ours = (t: string) =>
    t.split(/(?<=[.。!?])\s+|\n/).filter((x) => /송영신목장|우리\s*(우유|목장)|저희/.test(x));
  for (const [where, t] of surfaces) {
    it(`${where}: 우리 목장 문장에 '풀과 건초'·'풀을 뜯/먹여'가 없다`, () => {
      for (const sentence of ours(t)) expect(sentence).not.toMatch(/풀과\s*건초|풀을\s*(뜯|먹)/);
    });
  }
  it("손님 화면 소스(컴포넌트·페이지)에 '풀과 건초'·'풀을 뜯'이 없다", () => {
    for (const f of ["components/FarmBand.tsx", "components/Provenance.tsx", "components/TrustBadges.tsx", "components/WhyBand.tsx", "components/RegenerativeBand.tsx"]) {
      expect(src(f), f).not.toMatch(/풀과\s*건초|풀을\s*뜯|풀을\s*먹여/);
    }
  });
  it("도우미는 '건초만'(보조사료 있음)·생풀 급여를 말하지 않도록 지시받는다", () => {
    const k = buildCustomerSystemPrompt();
    expect(k).toMatch(/건초를 중심으로/);
    expect(k).toMatch(/생풀은 먹이지 않습니다/);
  });
});

describe("/learn/hay-milk — 비회원·국내 인증 제도 안내(2026-11-13 회장님 확인)", () => {
  it("ARGE 회원이 아니고 로고·EU 표장을 쓰지 않으며, 국내에는 헤이밀크 인증 제도가 없다고 밝힌다", () => {
    const last = hay.sections[hay.sections.length - 1].paragraphs.join(" ");
    expect(last).toMatch(/ARGE Heumilch 회원이 아니며/);
    expect(last).toMatch(/국내에는 헤이밀크를 인증하는 제도가 없습니다/);
  });
});

