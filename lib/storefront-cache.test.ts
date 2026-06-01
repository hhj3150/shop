import { describe, it, expect, vi } from "vitest";
import { createCatalogCache } from "./storefront-cache";
import type { CommercialRow } from "./storefront-merge";

const m = (over: Partial<CommercialRow> = {}): Map<string, CommercialRow> =>
  new Map([["milk-180", { id: "milk-180", price: 3500, stock: null, active: true, ...over }]]);

describe("createCatalogCache", () => {
  it("load는 fetcher를 1회만 호출하고 결과를 공유한다", async () => {
    const fetcher = vi.fn().mockResolvedValue(m());
    const cache = createCatalogCache(fetcher);
    const [a, b] = await Promise.all([cache.load(), cache.load()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("실패 시 캐시를 비워 다음 load가 재시도한다", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValueOnce(m());
    const cache = createCatalogCache(fetcher);
    await expect(cache.load()).rejects.toThrow("net");
    const ok = await cache.load(); // 재시도 성공
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(ok.get("milk-180")?.price).toBe(3500);
  });

  it("refresh는 캐시를 무효화하고 새로 적재한다", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(m({ price: 3500 }))
      .mockResolvedValueOnce(m({ price: 4000 }));
    const cache = createCatalogCache(fetcher);
    expect((await cache.load()).get("milk-180")?.price).toBe(3500);
    const refreshed = await cache.refresh();
    expect(refreshed.get("milk-180")?.price).toBe(4000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
