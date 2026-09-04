// 인쇄 라벨 ↔ 쇼핑몰 표기 일관성 회귀 테스트.
//
//   손님은 받은 병의 라벨과 상세페이지를 나란히 본다. 둘이 다르면 그 순간 신뢰가 깨진다
//   (실제로 영양성분 8개 항목 중 5~7개가 어긋나 있었다 — 요거트는 콜레스테롤이 3배로 적혀
//   있었다). 값의 출처는 언제나 인쇄 라벨(한두패키지 2026-07-29 교정본)이다.
//
//   여기서 지키는 것:
//     ① 한 제품 안에서 kcal · 내용량 문구 · 스펙 열량이 서로 어긋나지 않는다.
//     ② 같은 라인의 180mL(총량 표기)과 대용량(100mL당 표기)이 같은 우유를 말한다.
//     ③ 발효유는 라벨에만 있는 항목(유산균수·무지유고형분·살균방법)을 빠뜨리지 않는다.
import { describe, it, expect } from "vitest";
import { PRODUCTS, type Product } from "./products";

function get(id: string): Product {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) throw new Error(`제품 없음: ${id}`);
  return p;
}

// "8.6 g" → 8.6 / "70 mg" → 70
function num(amount: string): number {
  const m = amount.match(/-?[\d.]+/);
  return m ? Number(m[0]) : NaN;
}

function row(p: Product, label: string): number {
  const r = p.nutrition?.rows.find((x) => x.label === label);
  if (!r) throw new Error(`${p.id}: '${label}' 행 없음`);
  return num(r.amount);
}

const FOODS = ["milk-180", "milk-750", "yogurt-180", "yogurt-500"] as const;

describe("① 제품 안에서 열량 표기가 어긋나지 않는다", () => {
  it.each(FOODS)("%s — kcal · 내용량 문구 · 스펙 열량이 같은 수를 말한다", (id) => {
    const p = get(id);
    expect(p.label.content).toContain(String(p.kcal));
    const kcalSpec = p.specs.find((s) => s.label === "열량");
    expect(kcalSpec).toBeDefined();
    expect(kcalSpec!.value).toContain(String(p.kcal));
  });

  it.each(FOODS)("%s — 영양정보표에 8개 항목이 모두 있다", (id) => {
    const p = get(id);
    expect(p.nutrition).toBeDefined();
    expect(p.nutrition!.rows.map((r) => r.label)).toEqual([
      "나트륨", "탄수화물", "당류", "지방", "트랜스지방", "포화지방", "콜레스테롤", "단백질",
    ]);
  });
});

describe("② 180mL(총량 표기)과 대용량(100mL당 표기)이 같은 우유를 말한다", () => {
  // 180mL 총량 ÷ 1.8 = 100mL당. 라벨은 유효숫자 2자리로 반올림하므로 여유를 둔다.
  const PAIRS = [
    { small: "milk-180", large: "milk-750" },
    { small: "yogurt-180", large: "yogurt-500" },
  ] as const;

  it.each(PAIRS)("$small ↔ $large", ({ small, large }) => {
    const s = get(small);
    const l = get(large);
    expect(s.nutrition!.basis).toBe("총 내용량 180mL당");
    expect(l.nutrition!.basis).toBe("100mL당");

    for (const key of ["지방", "탄수화물", "당류", "단백질", "포화지방"]) {
      const per100 = row(s, key) / 1.8;
      const declared = row(l, key);
      const diff = Math.abs(per100 - declared);
      // 표기 반올림 허용: 절대 0.6 g 또는 상대 15% 이내.
      expect({ key, ok: diff <= 0.6 || diff / Math.max(per100, 0.01) <= 0.15 })
        .toEqual({ key, ok: true });
    }
  });

  it.each(PAIRS)("$small ↔ $large — 총 열량이 용량 비율과 맞는다", ({ small, large }) => {
    const s = get(small);
    const l = get(large);
    const smallMl = 180;
    const largeMl = large === "milk-750" ? 750 : 500;
    const expected = (s.kcal / smallMl) * largeMl;
    // 라벨은 10 kcal 단위로 정리해 표기한다 — 15% 이내면 같은 제품으로 본다.
    expect(Math.abs(l.kcal - expected) / expected).toBeLessThanOrEqual(0.15);
  });
});

describe("③ 발효유는 라벨에만 있는 항목을 빠뜨리지 않는다", () => {
  it.each(["yogurt-180", "yogurt-500"])("%s — 유산균수·무지유고형분·살균방법이 있다", (id) => {
    const p = get(id);
    expect(p.label.cultures).toBeTruthy();
    expect(p.label.milkSolids).toBeTruthy();
    expect(p.label.sterilization).toBeTruthy();
  });

  it.each(["milk-180", "milk-750"])("%s — 우유는 살균방법을 표기한다(유산균 항목은 없다)", (id) => {
    const p = get(id);
    expect(p.label.sterilization).toBeTruthy();
    expect(p.label.cultures).toBeUndefined();
  });

  it.each(FOODS)("%s — 품목보고번호가 있다", (id) => {
    expect(get(id).label.reportNo).toMatch(/^\d{12}$/);
  });

  it("품목보고번호는 라인별로 하나다(우유 …181 · 발효유 …182)", () => {
    expect(get("milk-180").label.reportNo).toBe(get("milk-750").label.reportNo);
    expect(get("yogurt-180").label.reportNo).toBe(get("yogurt-500").label.reportNo);
    expect(get("milk-180").label.reportNo).not.toBe(get("yogurt-180").label.reportNo);
  });
});
