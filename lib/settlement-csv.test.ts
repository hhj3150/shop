import { describe, it, expect } from "vitest";
import { buildSettlementCsvRows, SETTLEMENT_CSV_HEADER } from "./settlement-csv";

const summary = {
  rows: [
    { name: "A2 저지 헤이밀크", volume: "750mL", qty: 40, revenue: 480000, cost: 200000, margin: 280000 },
    { name: "A2 저지 플레인 요거트", volume: "180mL", qty: 17, revenue: 102000, cost: 51000, margin: 51000 },
  ],
  taxableGross: 480000,
  taxFreeGross: 102000,
  supply: 436364,
  vat: 43636,
  revenue: 582000,
  totalCost: 251000,
  margin: 331000,
};

describe("buildSettlementCsvRows", () => {
  it("모든 행이 헤더와 같은 6칸이다", () => {
    const rows = buildSettlementCsvRows(summary);
    const width = SETTLEMENT_CSV_HEADER.length;
    expect(width).toBe(6);
    expect(rows.every((r) => r.length === width)).toBe(true);
  });

  it("헤더가 맨 앞", () => {
    const rows = buildSettlementCsvRows(summary);
    expect(rows[0]).toEqual(SETTLEMENT_CSV_HEADER);
  });

  it("데이터 행은 제품·용량·수량·매출·원가·마진 순", () => {
    const rows = buildSettlementCsvRows(summary);
    expect(rows[1]).toEqual(["A2 저지 헤이밀크", "750mL", "40", "480000", "200000", "280000"]);
  });

  it("합계 금액은 매출/원가/마진 컬럼(3/4/5)에 정렬된다 — 용량 칸 아님", () => {
    const rows = buildSettlementCsvRows(summary);
    const find = (label: string) => rows.find((r) => r[0] === label)!;
    // 과세/면세/공급/부가세/총매출 → 매출 컬럼(index 3)
    expect(find("과세매출")).toEqual(["과세매출", "", "", "480000", "", ""]);
    expect(find("면세매출")[3]).toBe("102000");
    expect(find("공급가액(과세)")[3]).toBe("436364");
    expect(find("부가세(10%)")[3]).toBe("43636");
    expect(find("총매출")[3]).toBe("582000");
    // 총원가 → 원가 컬럼(index 4)
    expect(find("총원가")).toEqual(["총원가", "", "", "", "251000", ""]);
    // 총마진 → 마진 컬럼(index 5)
    expect(find("총마진")).toEqual(["총마진", "", "", "", "", "331000"]);
    // 용량 컬럼(index 1)엔 어떤 합계 금액도 새지 않는다(밀림 회귀 가드)
    for (const label of ["과세매출", "면세매출", "공급가액(과세)", "부가세(10%)", "총매출", "총원가", "총마진"]) {
      expect(find(label)[1]).toBe("");
    }
  });
});
