import { describe, it, expect } from "vitest";
import { splitDemandByKind } from "./production-demand";
import type { DeliveryEntry } from "./delivery-roster";

// 테스트용 최소 주문/품목 형태. splitDemandByKind 는 items 와 kind 만 본다.
type O = { id: string };
type I = { product_name: string; volume: string; qty: number };

function entry(
  kind: "정기" | "단품",
  items: I[],
  id = "o"
): DeliveryEntry<O, I> {
  return { order: { id }, items, sig: "", kind };
}

describe("splitDemandByKind", () => {
  it("정기/단품을 제품키별 수량으로 분리한다", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 3 }], "b"),
      entry("단품", [{ product_name: "헤이밀크", volume: "750mL", qty: 5 }], "c"),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 180mL": 5 });
    expect(r.단품).toEqual({ "헤이밀크 750mL": 5 });
  });

  it("한 엔트리에 여러 품목이면 각 제품키로 합산한다", () => {
    const entries = [
      entry("정기", [
        { product_name: "플레인", volume: "500mL", qty: 1 },
        { product_name: "헤이밀크", volume: "180mL", qty: 4 },
      ]),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 500mL": 1, "헤이밀크 180mL": 4 });
    expect(r.단품).toEqual({});
  });

  it("같은 제품이 정기·단품 양쪽에 있어도 kind별로 따로 센다", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("단품", [{ product_name: "플레인", volume: "180mL", qty: 7 }], "b"),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 180mL": 2 });
    expect(r.단품).toEqual({ "플레인 180mL": 7 });
  });

  it("빈 입력은 두 빈 객체", () => {
    const r = splitDemandByKind([]);
    expect(r.정기).toEqual({});
    expect(r.단품).toEqual({});
  });

  // 회귀 가드: 정기/단품으로 나눠도 제품별 총량은 변하지 않는다(분리는 총합 보존).
  it("정기+단품 합 == kind 무시 전체 제품 합", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("단품", [{ product_name: "플레인", volume: "180mL", qty: 7 }], "b"),
      entry("정기", [
        { product_name: "헤이밀크", volume: "750mL", qty: 3 },
        { product_name: "플레인", volume: "500mL", qty: 1 },
      ], "c"),
      entry("단품", [{ product_name: "헤이밀크", volume: "750mL", qty: 4 }], "d"),
    ];
    const r = splitDemandByKind(entries);

    const merged: Record<string, number> = { ...r.정기 };
    for (const [k, v] of Object.entries(r.단품)) merged[k] = (merged[k] ?? 0) + v;

    const naive: Record<string, number> = {};
    for (const e of entries) {
      for (const it of e.items) {
        const key = `${it.product_name} ${it.volume}`;
        naive[key] = (naive[key] ?? 0) + it.qty;
      }
    }
    expect(merged).toEqual(naive);
    expect(merged).toEqual({ "플레인 180mL": 9, "플레인 500mL": 1, "헤이밀크 750mL": 7 });
  });
});
