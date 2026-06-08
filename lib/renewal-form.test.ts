import { describe, it, expect } from "vitest";
import {
  productIdFor,
  activeBlockItems,
  prefillFormItems,
  buildRenewalItems,
  pruneToActive,
  usedDeliveryDays,
} from "./renewal-form";
import type { MySubscription } from "./subscriptions";
import type { RawBlock, BlockItem } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// PRODUCTS 의 실제 (name, volume) — 매칭 테스트용.
const MILK_180 = { name: "A2 저지 헤이밀크", volume: "180mL", id: "milk-180" };
const MILK_750 = { name: "A2 저지 헤이밀크", volume: "750mL", id: "milk-750" };

function item(name: string, volume: string, qty: number, unitPrice = 3000): BlockItem {
  return { productName: name, volume, qty, unitPrice };
}

function block(items: BlockItem[], weeks: number, day: DeliveryDay = "mon"): RawBlock {
  return {
    orderId: `o-${Math.random()}`,
    weeks,
    deliveryDay: day,
    shippingPerWeek: 4000,
    items,
  };
}

function sub(partial: Partial<MySubscription>): MySubscription {
  return {
    slotId: 1,
    deliveryDay: "mon",
    status: "활성",
    startedAt: null,
    paused: false,
    pausedAt: null,
    pausedDays: 0,
    totalWeeks: 4,
    periodMonths: 1,
    orderNo: "S-1",
    totalAmount: 0,
    blocks: [],
    ...partial,
  };
}

describe("productIdFor", () => {
  it("이름+용량으로 카탈로그 product_id 매칭", () => {
    expect(productIdFor(MILK_180.name, MILK_180.volume)).toBe(MILK_180.id);
    expect(productIdFor(MILK_750.name, MILK_750.volume)).toBe(MILK_750.id);
  });

  it("매칭 없으면 null", () => {
    expect(productIdFor("없는 제품", "999mL")).toBeNull();
    expect(productIdFor(MILK_180.name, "999mL")).toBeNull();
  });
});

describe("activeBlockItems", () => {
  it("블록 없으면 빈 배열", () => {
    expect(activeBlockItems(sub({ blocks: [] }))).toEqual([]);
  });

  it("미시작이면 첫 블록 구성", () => {
    const b = block([item(MILK_180.name, MILK_180.volume, 2)], 4);
    const result = activeBlockItems(sub({ blocks: [b], startedAt: null }));
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(2);
  });

  it("연장(2블록): 현재 회차가 속한 블록 구성을 돌려준다", () => {
    // 1블록 milk-180 ×1 (4주), 2블록 milk-750 ×3 (4주). 시작일이 충분히 과거여서
    //   현재 회차가 2블록 구간(5회차+)에 든다고 가정.
    const b1 = block([item(MILK_180.name, MILK_180.volume, 1)], 4);
    const b2 = block([item(MILK_750.name, MILK_750.volume, 3)], 4);
    const started = "2020-01-06"; // 한참 과거 → 8회 모두 발송 완료(마지막=2블록)
    const result = activeBlockItems(
      sub({ blocks: [b1, b2], startedAt: started, totalWeeks: 8 })
    );
    expect(result).toHaveLength(1);
    expect(result[0].volume).toBe(MILK_750.volume);
    expect(result[0].qty).toBe(3);
  });
});

describe("prefillFormItems", () => {
  it("활성 블록 → productId·qty 프리필", () => {
    const b = block(
      [item(MILK_180.name, MILK_180.volume, 2), item(MILK_750.name, MILK_750.volume, 1)],
      4
    );
    const result = prefillFormItems(sub({ blocks: [b] }));
    expect(result).toEqual(
      expect.arrayContaining([
        { productId: MILK_180.id, qty: 2 },
        { productId: MILK_750.id, qty: 1 },
      ])
    );
    expect(result).toHaveLength(2);
  });

  it("매칭 안 되는 품목은 제외", () => {
    const b = block(
      [item("단종된 제품", "1L", 5), item(MILK_180.name, MILK_180.volume, 1)],
      4
    );
    const result = prefillFormItems(sub({ blocks: [b] }));
    expect(result).toEqual([{ productId: MILK_180.id, qty: 1 }]);
  });

  it("같은 product_id 는 수량 합산", () => {
    const b = block(
      [item(MILK_180.name, MILK_180.volume, 2), item(MILK_180.name, MILK_180.volume, 3)],
      4
    );
    const result = prefillFormItems(sub({ blocks: [b] }));
    expect(result).toEqual([{ productId: MILK_180.id, qty: 5 }]);
  });
});

describe("buildRenewalItems", () => {
  it("qty>0 만 product_id 형태로 변환", () => {
    const result = buildRenewalItems([
      { productId: "milk-180", qty: 2 },
      { productId: "milk-750", qty: 0 },
      { productId: "yogurt-180", qty: 1 },
    ]);
    expect(result).toEqual([
      { product_id: "milk-180", qty: 2 },
      { product_id: "yogurt-180", qty: 1 },
    ]);
  });

  it("전부 0 이면 빈 배열", () => {
    expect(buildRenewalItems([{ productId: "milk-180", qty: 0 }])).toEqual([]);
  });
});

describe("pruneToActive", () => {
  it("active 목록에 없는 id(판매종료) 제거", () => {
    const result = pruneToActive(
      { "milk-180": 2, "milk-750": 1 },
      ["milk-180"]
    );
    expect(result).toEqual({ "milk-180": 2 });
  });

  it("모두 active 면 동일 참조 그대로 반환(무한 렌더 방지)", () => {
    const input = { "milk-180": 2, "milk-750": 1 };
    const result = pruneToActive(input, ["milk-180", "milk-750", "yogurt-180"]);
    expect(result).toBe(input);
  });

  it("빈 맵은 그대로", () => {
    const input = {};
    expect(pruneToActive(input, ["milk-180"])).toBe(input);
  });
});

describe("usedDeliveryDays", () => {
  it("다른 활성 슬롯의 요일만 모은다(현재 슬롯 제외)", () => {
    const subs = [
      sub({ slotId: 1, deliveryDay: "mon", status: "활성" }),
      sub({ slotId: 2, deliveryDay: "wed", status: "활성" }),
      sub({ slotId: 3, deliveryDay: "fri", status: "활성" }),
    ];
    const used = usedDeliveryDays(subs, 1);
    expect(used.has("mon")).toBe(false); // 현재 슬롯 → 제외
    expect(used.has("wed")).toBe(true);
    expect(used.has("fri")).toBe(true);
  });

  it("비활성(대기 등) 슬롯은 무시", () => {
    const subs = [
      sub({ slotId: 1, deliveryDay: "mon", status: "활성" }),
      sub({ slotId: 2, deliveryDay: "tue", status: "대기" }),
    ];
    const used = usedDeliveryDays(subs, 1);
    expect(used.has("tue")).toBe(false);
  });
});
