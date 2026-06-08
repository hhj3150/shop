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
    <div className="mt-5">
      {/* 가격 — 핵심 정보. 또렷하되 콤팩트하게 */}
      <p className="text-[clamp(1.35rem,4.5vw,1.8rem)] font-semibold leading-none text-ink lining-nums tabular-nums">
        {formatKRW(live.price)}
        <span className="ml-1.5 align-baseline text-[14px] font-normal text-mute">/ 회</span>
      </p>
      {/* 회원 특권 — 브랜드 그린으로 적당히 강조 */}
      <p className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center rounded-full bg-hey-green/12 px-3 py-1 text-[13.5px] font-semibold text-hey-green lining-nums">
          창립 500인 회원 특권 −{maxRate}%
        </span>
        {live.soldOut && <span className="text-[13px] text-mute">· 품절</span>}
      </p>
    </div>
  );
}
