"use client";

// 상세 페이지 상업 가드: 라이브 가격 라인 + 숨김(active=false) 시 판매중지 안내.
//   콘텐츠(SSG)는 서버에서 그대로 렌더하고, 가격/노출만 이 컴포넌트가 클라이언트에서 보정.
import { formatKRW, type Product } from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function ProductHeroPrice({ product, maxRate }: { product: Product; maxRate: number }) {
  const { map } = useStorefrontCatalog();
  const live = mergeProduct(product, map.get(product.id));
  return (
    <p className="mt-6 text-[14px] text-ink-soft">
      회당{" "}
      <span className="font-medium tabular-nums text-ink">{formatKRW(live.price)}</span>
      <span className="mx-2 text-line">·</span>
      <span className="text-gold-deep">창립 500인 회원 특권 −{maxRate}%</span>
      {live.soldOut && <span className="ml-2 text-mute">· 품절</span>}
    </p>
  );
}
