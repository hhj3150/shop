import { describe, expect, it } from "vitest";
import { onceBridge, pickBridgeItem } from "./once-bridge";
import { PRODUCTS, PUBLIC_PRODUCTS } from "./products";

describe("1회 구매 → 정기구독 안내", () => {
  it("가장 많이 담은 제품을 대표로, 같으면 먼저 담긴 것", () => {
    expect(pickBridgeItem([{ productId: "a", qty: 1 }, { productId: "b", qty: 3 }])).toBe("b");
    expect(pickBridgeItem([{ productId: "a", qty: 2 }, { productId: "b", qty: 2 }])).toBe("a");
    expect(pickBridgeItem([])).toBeNull();
    expect(pickBridgeItem([{ productId: "a", qty: 0 }])).toBeNull();
  });

  it("공개 제품이면 그 제품 상세와 최장 기간 병당가를 준다", () => {
    for (const p of PUBLIC_PRODUCTS) {
      const b = onceBridge(p.id)!;
      expect(b.href).toBe(`/products/${p.id}`);
      expect(b.listPrice).toBe(p.price);
      expect(b.maxPct).toBe(20);
      expect(b.fromPrice).toBe(Math.round((p.price * 0.8) / 10) * 10);
      expect(b.fromPrice).toBeLessThan(b.listPrice);
    }
  });

  it("모르는 id · 비공개 제품 · 빈 값은 null (일반 문구로 되돌아간다)", () => {
    expect(onceBridge(null)).toBeNull();
    expect(onceBridge("")).toBeNull();
    expect(onceBridge("../admin")).toBeNull();
    for (const p of PRODUCTS.filter((x) => x.unpublished)) expect(onceBridge(p.id)).toBeNull();
  });
});
