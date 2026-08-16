// 스토어프론트 상업 필드 머지/판정 — React 비의존 순수 로직(단위 테스트 대상).
import type { Product } from "@/lib/products";

// product_catalog 중 스토어프론트가 쓰는 최소 상업 필드.
export type CommercialRow = {
  id: string;
  price: number;
  stock: number | null; // null=무제한, 0=품절
  active: boolean;
};

// 정적 Product + DB 상업 상태를 합친 표시용 모델.
export type LiveProduct = Product & {
  active: boolean;
  stock: number | null;
  soldOut: boolean;
  hidden: boolean;
};

// 정적 상품에 카탈로그 row를 머지(불변, 새 객체). row 없으면 정적 가격 폴백.
//   미공개(unpublished) 제품은 DB row의 active와 무관하게 항상 숨긴다 — 출시 전
//   제품이 카탈로그 row 하나 때문에 손님 화면에 새는 것을 코드에서 막는다.
export function mergeProduct(product: Product, row?: CommercialRow): LiveProduct {
  const hidden = product.unpublished === true || (row ? !row.active : false);
  return {
    ...product,
    price: row?.price ?? product.price,
    active: !hidden,
    stock: row?.stock ?? null,
    soldOut: row?.stock === 0,
    hidden,
  };
}

// 목록 컨텍스트용: 머지 후 hidden 제외(soldOut은 배지로 노출하므로 포함).
export function visibleProducts(
  products: Product[],
  rows: Map<string, CommercialRow>
): LiveProduct[] {
  return products
    .map((p) => mergeProduct(p, rows.get(p.id)))
    .filter((p) => !p.hidden);
}

// 주문 RPC 거부 메시지(품절/판매중지/미존재)를 재고·노출 거부로 감지.
const REJECTION_MARKERS = ["품절된 상품", "판매 중지", "존재하지 않는"];
export function isCatalogRejection(message: string): boolean {
  return REJECTION_MARKERS.some((m) => message.includes(m));
}
