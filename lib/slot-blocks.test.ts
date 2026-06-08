import { describe, it, expect } from "vitest";
import { buildRawBlocks } from "./slot-blocks";
import { normalizeBlocks, type RawBlock } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// ─── shared fixtures ──────────────────────────────────────────────────────────

type OrderInput = { id: string; block_weeks: number; shipping_fee: number };

const chicken = { delivery_day: "tue" as DeliveryDay, qty: 2, unit_price: 10800, product_name: "닭가슴살", volume: "200g" };
const beef    = { delivery_day: "wed" as DeliveryDay, qty: 1, unit_price: 30600, product_name: "소고기",   volume: "150g" };

const o0: OrderInput = { id: "o0", block_weeks: 4, shipping_fee: 16000 };
const o1: OrderInput = { id: "o1", block_weeks: 8, shipping_fee: 32000 };
const o2: OrderInput = { id: "o2", block_weeks: 4, shipping_fee: 16000 }; // legacy (no items)

// ─── tests ────────────────────────────────────────────────────────────────────

describe("buildRawBlocks", () => {
  it("original + 2 renewal blocks with items → correct order, deliveryDay, items, shippingPerWeek", () => {
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      [o1.id, [beef]],
    ]);
    const result = buildRawBlocks(o0, [o1], itemsByOrder);

    expect(result).toHaveLength(2);

    const [block0, block1] = result;

    // original first
    expect(block0.orderId).toBe("o0");
    expect(block0.weeks).toBe(4);
    expect(block0.deliveryDay).toBe("tue");
    expect(block0.shippingPerWeek).toBe(4000); // Math.round(16000 / 4)
    expect(block0.items).toEqual([
      { productName: "닭가슴살", volume: "200g", qty: 2, unitPrice: 10800 },
    ]);

    // renewal block
    expect(block1.orderId).toBe("o1");
    expect(block1.weeks).toBe(8);
    expect(block1.deliveryDay).toBe("wed");
    expect(block1.shippingPerWeek).toBe(4000); // Math.round(32000 / 8)
    expect(block1.items).toEqual([
      { productName: "소고기", volume: "150g", qty: 1, unitPrice: 30600 },
    ]);
  });

  it("legacy renewal order with no items → deliveryDay null, items []", () => {
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      // o2 has no entry → legacy
    ]);
    const result = buildRawBlocks(o0, [o2], itemsByOrder);

    expect(result).toHaveLength(2);
    const legacy = result[1];
    expect(legacy.orderId).toBe("o2");
    expect(legacy.deliveryDay).toBeNull();
    expect(legacy.items).toEqual([]);
    expect(legacy.shippingPerWeek).toBe(4000); // still computed
  });

  it("renewalOrders passed out of id order → sorted ascending in output", () => {
    const o3: OrderInput = { id: "o3", block_weeks: 4, shipping_fee: 16000 };
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      [o1.id, [beef]],
      [o3.id, [chicken]],
    ]);
    // Pass renewals in reverse order: o3, o1
    const result = buildRawBlocks(o0, [o3, o1], itemsByOrder);

    expect(result).toHaveLength(3);
    // Should be o0, o1, o3 (sorted ascending by id)
    expect(result[0].orderId).toBe("o0");
    expect(result[1].orderId).toBe("o1");
    expect(result[2].orderId).toBe("o3");
  });

  it("block_weeks=0 guard → shippingPerWeek 0 (no divide-by-zero)", () => {
    const oZero: OrderInput = { id: "oz", block_weeks: 0, shipping_fee: 16000 };
    const itemsByOrder = new Map([[o0.id, [chicken]]]);
    const result = buildRawBlocks(o0, [oZero], itemsByOrder);

    const zeroBlock = result.find((b) => b.orderId === "oz")!;
    expect(zeroBlock.shippingPerWeek).toBe(0);
  });

  it("round-trip: feeding output into normalizeBlocks resolves legacy inheritance", () => {
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      // o2 is legacy
    ]);
    const rawBlocks: RawBlock[] = buildRawBlocks(o0, [o2], itemsByOrder);
    const resolved = normalizeBlocks(rawBlocks);

    expect(resolved).toHaveLength(2);
    // legacy block inherits from original
    expect(resolved[1].deliveryDay).toBe("tue");
    expect(resolved[1].items).toEqual([
      { productName: "닭가슴살", volume: "200g", qty: 2, unitPrice: 10800 },
    ]);
    expect(resolved[1].orderId).toBe("o0"); // attribution stays at original
    // rounds accumulate correctly
    expect(resolved[0].fromRound).toBe(1);
    expect(resolved[0].toRound).toBe(5);
    expect(resolved[1].fromRound).toBe(5);
    expect(resolved[1].toRound).toBe(9);
  });
});
