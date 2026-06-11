import { describe, it, expect } from "vitest";
import {
  DEFAULT_DELIVERY_METHOD,
  isPickup,
  parseDeliveryMethod,
  onceShippingFor,
  subShippingFor,
} from "./delivery-method";

describe("수령방법 기본·판정", () => {
  it("기본은 택배", () => {
    expect(DEFAULT_DELIVERY_METHOD).toBe("택배");
  });
  it("isPickup은 방문수령일 때만 true", () => {
    expect(isPickup("방문수령")).toBe(true);
    expect(isPickup("택배")).toBe(false);
  });
});

describe("경계 검증 parseDeliveryMethod", () => {
  it("방문수령만 방문수령, 그 외(잘못된 값·null)는 택배로 폴백", () => {
    expect(parseDeliveryMethod("방문수령")).toBe("방문수령");
    expect(parseDeliveryMethod("택배")).toBe("택배");
    expect(parseDeliveryMethod("pickup")).toBe("택배");
    expect(parseDeliveryMethod(null)).toBe("택배");
    expect(parseDeliveryMethod(undefined)).toBe("택배");
  });
});

describe("단품 배송비 onceShippingFor", () => {
  it("방문수령이면 0", () => {
    expect(onceShippingFor("방문수령", 24000, "06000")).toBe(0);
    expect(onceShippingFor("방문수령", 24000, "63000")).toBe(0);
  });
  it("택배면 일반 4,000 / 특수지역 5,000", () => {
    expect(onceShippingFor("택배", 24000, "06000")).toBe(4000);
    expect(onceShippingFor("택배", 24000, "63000")).toBe(5000);
  });
});

describe("구독 배송비 subShippingFor (기간 전체)", () => {
  it("방문수령이면 0(주수 무관)", () => {
    expect(subShippingFor("방문수령", 24000, "06000", 8)).toBe(0);
  });
  it("택배면 회당 택배비 × 주수", () => {
    expect(subShippingFor("택배", 24000, "06000", 8)).toBe(4000 * 8);
    expect(subShippingFor("택배", 24000, "63000", 4)).toBe(5000 * 4);
  });
});
