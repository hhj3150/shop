"use client";

// 스토어프론트용 product_catalog 라이브 조회 훅. 방문 시 1회 조회, 모듈 캐시 싱글톤으로 공유.
//   상업 필드(price·stock·active)만 읽는다. 거부 후 refresh()로 재조회.
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { CommercialRow } from "@/lib/storefront-merge";
import { createCatalogCache, type CatalogMap } from "@/lib/storefront-cache";

async function fetchCommercial(): Promise<CatalogMap> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("product_catalog")
    .select("id, price, stock, active");
  if (error) throw error;
  const map: CatalogMap = new Map();
  for (const r of (data as CommercialRow[]) ?? []) map.set(r.id, r);
  return map;
}

// 모듈 싱글톤 — 방문 전체에서 1회 조회 공유.
const catalogCache = createCatalogCache(fetchCommercial);

export function useStorefrontCatalog() {
  const [map, setMap] = useState<CatalogMap>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    catalogCache
      .load()
      .then((m) => {
        if (alive) {
          setMap(m);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false); // 실패해도 정적 폴백으로 동작
      });
    return () => {
      alive = false;
    };
  }, []);

  // 주문 거부(품절/숨김) 후 강제 재조회.
  async function refresh() {
    const m = await catalogCache.refresh();
    setMap(m);
  }

  return { map, loading, refresh };
}
