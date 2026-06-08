import { describe, it, expect } from "vitest";
import { productionShortages } from "@/lib/production-shortage";

const keys = ["A", "B", "C"] as const;

describe("productionShortages", () => {
  it("실제생산이 필요량보다 적은 제품만 부족으로 잡는다", () => {
    const required = { A: 10, B: 5, C: 3 };
    const produced = { A: 7, B: 5, C: 4 };
    const result = productionShortages(keys, required, produced);
    expect(result).toEqual([{ key: "A", required: 10, produced: 7, short: 3 }]);
  });

  it("필요량이 0이면 부족으로 잡지 않는다(생산만 한 경우)", () => {
    const required = { A: 0, B: 0, C: 0 };
    const produced = { A: 5, B: 0, C: 0 };
    expect(productionShortages(keys, required, produced)).toEqual([]);
  });

  it("생산이 0이고 필요량이 있으면 전량 부족으로 잡는다", () => {
    const required = { A: 4, B: 0, C: 6 };
    const produced = { A: 0, B: 0, C: 0 };
    expect(productionShortages(keys, required, produced)).toEqual([
      { key: "A", required: 4, produced: 0, short: 4 },
      { key: "C", required: 6, produced: 0, short: 6 },
    ]);
  });

  it("정확히 맞으면 부족 없음", () => {
    const required = { A: 3, B: 3, C: 3 };
    const produced = { A: 3, B: 3, C: 3 };
    expect(productionShortages(keys, required, produced)).toEqual([]);
  });

  it("누락된 키는 0으로 본다", () => {
    const required = { A: 2 };
    const produced = {};
    expect(productionShortages(keys, required, produced)).toEqual([
      { key: "A", required: 2, produced: 0, short: 2 },
    ]);
  });
});
