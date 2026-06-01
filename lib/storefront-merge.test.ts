import { describe, it, expect } from "vitest";
import { mergeProduct, visibleProducts, isCatalogRejection, type CommercialRow } from "./storefront-merge";
import { PRODUCTS } from "@/lib/products";

const base = PRODUCTS[0]; // milk-180, price 3500
const row = (over: Partial<CommercialRow>): CommercialRow => ({
  id: base.id, price: 4000, stock: null, active: true, ...over,
});

describe("mergeProduct", () => {
  it("row 없으면 정적 가격 폴백, 노출·재고무제한", () => {
    const m = mergeProduct(base, undefined);
    expect(m.price).toBe(base.price);
    expect(m.active).toBe(true);
    expect(m.hidden).toBe(false);
    expect(m.soldOut).toBe(false);
    expect(m.stock).toBeNull();
  });
  it("row 있으면 DB 가격 사용", () => {
    expect(mergeProduct(base, row({ price: 4000 })).price).toBe(4000);
  });
  it("stock 0 → soldOut", () => {
    expect(mergeProduct(base, row({ stock: 0 })).soldOut).toBe(true);
  });
  it("stock null → soldOut 아님", () => {
    expect(mergeProduct(base, row({ stock: null })).soldOut).toBe(false);
  });
  it("active false → hidden", () => {
    expect(mergeProduct(base, row({ active: false })).hidden).toBe(true);
  });
  it("원본 불변(새 객체)", () => {
    const m = mergeProduct(base, row({ price: 9999 }));
    expect(base.price).toBe(3500);
    expect(m).not.toBe(base);
  });
});

describe("visibleProducts", () => {
  it("hidden 제외, soldOut은 포함", () => {
    const rows = new Map<string, CommercialRow>([
      [PRODUCTS[0].id, row({ id: PRODUCTS[0].id, active: false })],
      [PRODUCTS[1].id, row({ id: PRODUCTS[1].id, stock: 0 })],
    ]);
    const vis = visibleProducts(PRODUCTS, rows);
    expect(vis.find((p) => p.id === PRODUCTS[0].id)).toBeUndefined();
    expect(vis.find((p) => p.id === PRODUCTS[1].id)?.soldOut).toBe(true);
  });
});

describe("isCatalogRejection", () => {
  it("품절/판매중지/미존재 메시지를 거부로 감지", () => {
    expect(isCatalogRejection("품절된 상품입니다: milk-180")).toBe(true);
    expect(isCatalogRejection("판매 중지되었거나 존재하지 않는 상품입니다")).toBe(true);
    expect(isCatalogRejection("존재하지 않는 제품입니다: x")).toBe(true);
  });
  it("일반 오류는 false", () => {
    expect(isCatalogRejection("네트워크 오류")).toBe(false);
  });
});
