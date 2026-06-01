// 카탈로그 Promise 캐시 — fetcher 주입형(React/Supabase 비의존, 단위 테스트 대상).
//   load: 최초 1회만 fetcher 호출 후 공유. 실패 시 캐시 비워 재시도 허용.
//   refresh: 캐시 무효화 후 재적재(주문 거부 뒤 사용).
import type { CommercialRow } from "@/lib/storefront-merge";

export type CatalogMap = Map<string, CommercialRow>;
export type CatalogFetcher = () => Promise<CatalogMap>;

export function createCatalogCache(fetcher: CatalogFetcher) {
  let cache: Promise<CatalogMap> | null = null;

  function load(): Promise<CatalogMap> {
    if (!cache) {
      cache = fetcher().catch((e) => {
        cache = null; // 실패 시 비워 다음 load에 재시도
        throw e;
      });
    }
    return cache;
  }

  function refresh(): Promise<CatalogMap> {
    cache = null;
    return load();
  }

  return { load, refresh };
}
