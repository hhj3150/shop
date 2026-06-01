// 상품 마스터(product_catalog) 데이터 접근 — 관리자 ERP용.
//   product_catalog 는 가격(price)·노출(active)의 단일 출처이며, 주문 RPC가
//   이 값으로 금액을 재계산한다. ERP 강화로 원가(cost)·재고(stock)를 더했다.
//   조회는 누구나(catalog_select_all), 수정은 관리자만(catalog_update_admin RLS).
import { getSupabase } from "@/lib/supabase";

// 카탈로그 1행. stock=null 이면 재고 미관리(무제한), 0 이면 품절.
export type CatalogProduct = {
  id: string;
  name: string;
  volume: string;
  price: number;
  cost: number;
  stock: number | null;
  tax_free: boolean;
  active: boolean;
};

// 관리자가 한 상품에서 바꿀 수 있는 필드(이름/용량/면세 여부는 불변).
export type CatalogPatch = {
  price?: number;
  cost?: number;
  stock?: number | null;
  active?: boolean;
};

// 전 상품을 id 순으로 조회.
export async function loadCatalog(): Promise<CatalogProduct[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("product_catalog")
      .select("id, name, volume, price, cost, stock, tax_free, active")
      .order("id");
    if (error) throw error;
    return (data as CatalogProduct[]) ?? [];
  } catch (error) {
    console.error("상품 카탈로그 조회 실패:", error);
    throw new Error("상품 정보를 불러오지 못했습니다.");
  }
}

// 한 상품의 일부 필드만 갱신. 값은 경계에서 정규화(음수 차단·정수 반올림).
export async function saveCatalogProduct(
  id: string,
  patch: CatalogPatch
): Promise<void> {
  try {
    const sb = getSupabase();
    const clean: CatalogPatch = {};
    if (patch.price !== undefined) clean.price = Math.max(0, Math.round(patch.price));
    if (patch.cost !== undefined) clean.cost = Math.max(0, Math.round(patch.cost));
    if (patch.stock !== undefined)
      clean.stock = patch.stock === null ? null : Math.max(0, Math.round(patch.stock));
    if (patch.active !== undefined) clean.active = patch.active;
    const { error } = await sb.from("product_catalog").update(clean).eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.error("상품 정보 저장 실패:", error);
    throw new Error("상품 정보 저장에 실패했습니다.");
  }
}

// 마진(원) = 판매가 − 원가. 음수 가능(원가 미입력 시 price 그대로).
export function unitMargin(p: Pick<CatalogProduct, "price" | "cost">): number {
  return p.price - p.cost;
}

// 마진율(%) = (판매가 − 원가) / 판매가 × 100. 판매가 0이면 0.
export function marginRate(p: Pick<CatalogProduct, "price" | "cost">): number {
  if (p.price <= 0) return 0;
  return Math.round((unitMargin(p) / p.price) * 100);
}
