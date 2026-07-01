import { describe, expect, it } from "vitest";
import { rawMilkBaseLiters, rawMilkForPeriod, volumeMl, PRODUCTION_KEYS } from "./production";

// 테스트는 실제 SKU 키 두 개를 골라 계산 규칙만 검증한다(제품 목록 변경에 견고).
const KEY_A = PRODUCTION_KEYS[0];
const KEY_B = PRODUCTION_KEYS[1];

describe("rawMilkForPeriod", () => {
  it("순 원유(제품 용량 합) + 회당 로스 × 생산일수", () => {
    const q = { [KEY_A]: 10, [KEY_B]: 4 };
    const base = rawMilkBaseLiters(q);
    // 로스 20L, 생산일수 3 → base + 60
    expect(rawMilkForPeriod(q, 20, 3)).toBe(Math.round((base + 60) * 10) / 10);
  });

  it("수량이 0이면 로스도 0 (생산 없는 기간은 원유도 0)", () => {
    expect(rawMilkForPeriod({}, 20, 5)).toBe(0);
    expect(rawMilkForPeriod({ [KEY_A]: 0 }, 20, 5)).toBe(0);
  });

  it("생산일수 0이면 로스 없이 순 원유만", () => {
    const q = { [KEY_A]: 6 };
    expect(rawMilkForPeriod(q, 20, 0)).toBe(rawMilkBaseLiters(q));
  });

  it("음수 로스·음수 생산일수는 0으로 클램프", () => {
    const q = { [KEY_A]: 6 };
    expect(rawMilkForPeriod(q, -5, -2)).toBe(rawMilkBaseLiters(q));
  });

  it("순 원유는 용량×수량/1000 (mL 기준)", () => {
    const q = { [KEY_A]: 2 };
    expect(rawMilkBaseLiters(q)).toBe(Math.round((volumeMl(KEY_A) * 2) / 100) / 10);
  });
});
