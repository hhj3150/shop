"use client";

// 상세 페이지 상업 가드: 라이브 가격 라인 + 숨김(active=false) 시 판매중지 안내.
//   콘텐츠(SSG)는 서버에서 그대로 렌더하고, 가격/노출만 이 컴포넌트가 클라이언트에서 보정.
import { formatKRW, subscribePrice, type Product } from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function ProductHeroPrice({ product, maxRate }: { product: Product; maxRate: number }) {
  const { map } = useStorefrontCatalog();
  const live = mergeProduct(product, map.get(product.id));
  // 회원 최대 특권가(가장 긴 기간 기준) — 첫눈에 실제 가치를 인지하도록 정가와 함께 노출.
  const memberPrice = subscribePrice(live.price, maxRate / 100);
  return (
    <div className="mt-4">
      {/* 가격 — 회원가를 앞세우고 정가는 취소선으로 가치 대비를 즉시 인지 */}
      <div className="flex items-baseline justify-center gap-2.5 lg:justify-start">
        <p className="text-[clamp(1.5rem,4vw,1.9rem)] font-semibold leading-none text-ink lining-nums tabular-nums">
          {formatKRW(memberPrice)}
          <span className="ml-1.5 align-baseline text-[13.5px] font-normal text-mute">/ 회</span>
        </p>
        <p className="text-[14px] text-mute line-through tabular-nums">{formatKRW(live.price)}</p>
      </div>
      {/* 회원 특권 — 브랜드 그린으로 적당히 강조 */}
      <p className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
        <span className="inline-flex items-center rounded-full bg-hey-green/12 px-2.5 py-0.5 text-[12.5px] font-semibold text-hey-green lining-nums">
          창립 500인 회원 특권 · 최대 −{maxRate}%
        </span>
        {live.soldOut && <span className="text-[13px] text-mute">· 품절</span>}
      </p>
    </div>
  );
}
