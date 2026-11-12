import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_PRODUCTS, type Product } from "@/lib/products";
import { mergeProduct, type CommercialRow, type LiveProduct } from "@/lib/storefront-merge";

// 서버 전용: product_catalog(가격·재고·노출의 단일 출처 — lib/catalog.ts)를 anon 으로 읽는다.
//   [왜] 검색·AI 에 나가는 가격(메타 설명·Product 구조화데이터·/faq 가격 문답·llms.txt)이 한 출처여야 한다.
//        관리자가 DB 에서 가격을 바꾸면 화면(하이드레이션 뒤)과 주문 금액은 DB 를 따르는데, 검색 문구만
//        lib/products.ts 의 정적 값을 말하면 같은 문서 안에서 가격이 둘이 된다.
//   스토어프론트(lib/storefront.ts)와 같은 select. 환경변수가 없거나 조회에 실패하면 빈 Map —
//   호출부는 정적 값(lib/products.ts)으로 폴백한다(페이지·라우트를 깨뜨리지 않는다).
//   React cache() — 한 번의 렌더(generateMetadata + page) 안에서 한 번만 조회한다.
export const fetchCatalogRows = cache(async (): Promise<Map<string, CommercialRow>> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return new Map();
  try {
    const sb = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.from("product_catalog").select("id, price, stock, active");
    if (error) throw new Error(error.message);
    return new Map(((data as CommercialRow[] | null) ?? []).map((r) => [r.id, r]));
  } catch (err) {
    console.error("product_catalog 조회 실패 — 정적 가격으로 폴백:", err);
    return new Map();
  }
});

/** 정적 제품 + DB 상업 상태(가격·재고·노출). */
export async function liveProduct(p: Product): Promise<LiveProduct> {
  return mergeProduct(p, (await fetchCatalogRows()).get(p.id));
}

/** 손님에게 보이는 제품만(미공개·DB 비노출 제외), 가격은 DB 값. */
export async function livePublicProducts(): Promise<LiveProduct[]> {
  const rows = await fetchCatalogRows();
  return PUBLIC_PRODUCTS.map((p) => mergeProduct(p, rows.get(p.id))).filter((p) => !p.hidden);
}
