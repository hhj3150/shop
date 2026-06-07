import { describe, it, expect } from "vitest";
import { productBucket, findUnmappedKeys, BUCKET_LABEL } from "./dispatch-buckets";

describe("productBucket", () => {
  it("현재 4개 SKU를 올바른 칸으로 분류한다", () => {
    expect(productBucket("A2 저지 헤이밀크", "180mL")).toBe(0); // 우유180
    expect(productBucket("A2 저지 헤이밀크", "750mL")).toBe(1); // 우유750
    expect(productBucket("A2 저지 플레인 요거트", "180mL")).toBe(2); // 요거트180
    expect(productBucket("A2 저지 플레인 요거트", "500mL")).toBe(3); // 요거트500
  });

  it("4개 칸에 없는 제품은 -1(미분류)", () => {
    expect(productBucket("A2 저지 헤이밀크", "500mL")).toBe(-1); // 우유500 — 칸 없음
    expect(productBucket("A2 저지 플레인 요거트", "750mL")).toBe(-1); // 요거트750 — 칸 없음
    expect(productBucket("수제 치즈", "200g")).toBe(-1);
    expect(productBucket("선물세트", "1L")).toBe(-1);
  });

  it("BUCKET_LABEL은 4칸", () => {
    expect(BUCKET_LABEL).toHaveLength(4);
  });
});

describe("findUnmappedKeys", () => {
  it("4개 칸에 매핑되지 않는 품목 키를 정렬·중복제거해 반환한다", () => {
    const items = [
      { product_name: "A2 저지 헤이밀크", volume: "180mL", qty: 2 }, // 매핑됨
      { product_name: "수제 치즈", volume: "200g", qty: 1 }, // 미분류
      { product_name: "A2 저지 헤이밀크", volume: "500mL", qty: 3 }, // 미분류(우유500)
      { product_name: "수제 치즈", volume: "200g", qty: 4 }, // 중복
    ];
    // ko 로케일 정렬: 한글이 라틴보다 앞 → 수제 치즈가 먼저.
    expect(findUnmappedKeys(items)).toEqual(["수제 치즈 200g", "A2 저지 헤이밀크 500mL"]);
  });

  it("모두 매핑되면 빈 배열", () => {
    const items = [
      { product_name: "A2 저지 헤이밀크", volume: "180mL", qty: 1 },
      { product_name: "A2 저지 플레인 요거트", volume: "500mL", qty: 1 },
    ];
    expect(findUnmappedKeys(items)).toEqual([]);
  });

  it("qty 0 인 미분류 품목은 무시(발송 수량 없음)", () => {
    const items = [{ product_name: "수제 치즈", volume: "200g", qty: 0 }];
    expect(findUnmappedKeys(items)).toEqual([]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(findUnmappedKeys([])).toEqual([]);
  });
});
