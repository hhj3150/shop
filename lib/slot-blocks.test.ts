import { describe, it, expect } from "vitest";
import { buildRawBlocks } from "./slot-blocks";
import { normalizeBlocks, type RawBlock } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// ─── shared fixtures ──────────────────────────────────────────────────────────

type OrderInput = { id: string; block_weeks: number; shipping_fee: number; created_at: string };

const chicken = { delivery_day: "tue" as DeliveryDay, qty: 2, unit_price: 10800, product_name: "닭가슴살", volume: "200g" };
const beef    = { delivery_day: "wed" as DeliveryDay, qty: 1, unit_price: 30600, product_name: "소고기",   volume: "150g" };

// orders.id is a random uuid (gen_random_uuid()) — NOT monotonic.
// created_at is the chronological signal.
const o0: OrderInput = { id: "uuid-aaa", block_weeks: 4, shipping_fee: 16000, created_at: "2026-01-06T00:00:00Z" };
const o1: OrderInput = { id: "uuid-bbb", block_weeks: 8, shipping_fee: 32000, created_at: "2026-02-03T00:00:00Z" };
const o2: OrderInput = { id: "uuid-ccc", block_weeks: 4, shipping_fee: 16000, created_at: "2026-02-03T00:00:00Z" }; // legacy (no items)

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
    expect(block0.orderId).toBe(o0.id);
    expect(block0.weeks).toBe(4);
    expect(block0.deliveryDay).toBe("tue");
    expect(block0.shippingPerWeek).toBe(4000); // Math.round(16000 / 4)
    expect(block0.items).toEqual([
      { productName: "닭가슴살", volume: "200g", qty: 2, unitPrice: 10800 },
    ]);

    // renewal block
    expect(block1.orderId).toBe(o1.id);
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
    expect(legacy.orderId).toBe(o2.id);
    expect(legacy.deliveryDay).toBeNull();
    expect(legacy.items).toEqual([]);
    expect(legacy.shippingPerWeek).toBe(4000); // still computed
  });

  it("renewalOrders passed out of created_at order → sorted by created_at ascending in output", () => {
    // Random uuids deliberately reverse-correlated with created_at to prove id-sort is wrong.
    const early: OrderInput = { id: "uuid-zzz", block_weeks: 4, shipping_fee: 16000, created_at: "2026-02-03T00:00:00Z" };
    const late: OrderInput  = { id: "uuid-aaa-late", block_weeks: 4, shipping_fee: 16000, created_at: "2026-03-03T00:00:00Z" };
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      [early.id, [beef]],
      [late.id, [chicken]],
    ]);
    // Pass renewals out of created_at order: late first, then early.
    const result = buildRawBlocks(o0, [late, early], itemsByOrder);

    expect(result).toHaveLength(3);
    // Original first, then renewals sorted by created_at ascending (early before late),
    // even though early.id ("uuid-zzz") sorts AFTER late.id ("uuid-aaa-late") by id.
    expect(result[0].orderId).toBe(o0.id);
    expect(result[1].orderId).toBe(early.id);
    expect(result[2].orderId).toBe(late.id);
  });

  it("equal created_at → id is deterministic tiebreaker", () => {
    const a: OrderInput = { id: "uuid-001", block_weeks: 4, shipping_fee: 16000, created_at: "2026-02-03T00:00:00Z" };
    const b: OrderInput = { id: "uuid-002", block_weeks: 4, shipping_fee: 16000, created_at: "2026-02-03T00:00:00Z" };
    const itemsByOrder = new Map([
      [o0.id, [chicken]],
      [a.id, [beef]],
      [b.id, [chicken]],
    ]);
    // Pass in reverse id order with identical created_at.
    const result = buildRawBlocks(o0, [b, a], itemsByOrder);

    expect(result.map((r) => r.orderId)).toEqual([o0.id, a.id, b.id]);
  });

  it("block_weeks=0 guard → shippingPerWeek 0 (no divide-by-zero)", () => {
    const oZero: OrderInput = { id: "uuid-zero", block_weeks: 0, shipping_fee: 16000, created_at: "2026-02-03T00:00:00Z" };
    const itemsByOrder = new Map([[o0.id, [chicken]]]);
    const result = buildRawBlocks(o0, [oZero], itemsByOrder);

    const zeroBlock = result.find((b) => b.orderId === oZero.id)!;
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
    expect(resolved[1].orderId).toBe(o0.id); // attribution stays at original
    // rounds accumulate correctly
    expect(resolved[0].fromRound).toBe(1);
    expect(resolved[0].toRound).toBe(5);
    expect(resolved[1].fromRound).toBe(5);
    expect(resolved[1].toRound).toBe(9);
  });
});
