// A2 우유·저지 해설 보강(2026-11-13) — 헤이밀크 글처럼 '제도·기관' 소제목을 갖추고, 반박 검증에서 고친 표현이 되돌아오지 않게.
import { describe, it, expect } from "vitest";
import { getLearnPage } from "./learn";

const text = (slug: string) => {
  const p = getLearnPage(slug)!;
  return [p.title, p.description, p.intro, ...p.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join("\n");
};
const heads = (slug: string) => getLearnPage(slug)!.sections.map((s) => s.heading);

describe("A2 우유 해설", () => {
  it("유전자형 판정·씨수소 공개·우유 분석 소제목이 있다", () => {
    expect(heads("a2-milk")).toEqual(
      expect.arrayContaining(["A2/A2 소는 어떻게 가려내나요?", "씨수소의 A2 유전자형은 어디에 공개되나요?", "우유만 보고도 A2인지 확인할 수 있나요?"])
    );
  });
  it("'67번째 아미노산 하나만' 같은 과장(UniProt 은 A1 의 다른 변이 자리도 적는다)을 쓰지 않는다", () => {
    expect(text("a2-milk")).not.toMatch(/하나만\s*다릅니다/);
  });
  it("분석법은 연구 단계·한계와 함께 적는다", () => {
    expect(text("a2-milk")).toMatch(/구분하지 못하고/);
  });
  it("상표처럼 보이는 소문자 'a2'·'a2 Milk' 표기를 쓰지 않는다(설명적 대문자 'A2'만)", () => {
    expect(text("a2-milk")).not.toMatch(/(?<![\w.])a2(?![\w.])/);
  });
});

describe("저지 해설", () => {
  it("저지섬 보호·허드북·혈통 등록·한국 등록 소제목이 있다", () => {
    expect(heads("jersey-milk")).toEqual(
      expect.arrayContaining(["저지섬은 어떻게 저지 소를 지켜 왔나요?", "'등록된 저지'는 무슨 뜻인가요?", "한국에서도 저지를 등록하나요?"])
    );
  });
  it("해외 품종 단체가 목장·제품을 인증·보증하지 않는다고 밝힌다", () => {
    expect(text("jersey-milk")).toMatch(/송영신목장이나 제품을 인증·보증한다는 뜻이 아닙니다/);
  });
  it("단체 소개의 최상급 문구('가장 오래된'·oldest)를 옮기지 않는다", () => {
    expect(text("jersey-milk")).not.toMatch(/가장\s*오래된|oldest|최고의/i);
  });
  it("국내 저지 두수는 출처 기관과 기준 시점을 함께 적는다", () => {
    expect(text("jersey-milk")).toMatch(/2022년 12월/);
    expect(text("jersey-milk")).toMatch(/2024년 6월/);
  });
});
