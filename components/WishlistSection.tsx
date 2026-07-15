"use client";

// 내 계정 — 찜한 제품 목록. 비어 있으면 섹션 자체를 그리지 않는다.
//   가격·품절은 라이브 카탈로그(product_catalog) 기준으로 보정해 표시한다.
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getProduct, formatKRW } from "@/lib/products";
import { fetchWishlist, removeWish } from "@/lib/wishlist";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function WishlistSection({ userId }: { userId: string }) {
  const [ids, setIds] = useState<string[]>([]);
  const { map } = useStorefrontCatalog();

  useEffect(() => {
    let alive = true;
    fetchWishlist(userId)
      .then((list) => {
        if (alive) setIds(list);
      })
      .catch(() => {
        // 조회 실패 시 섹션 비표시(치명적이지 않음).
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // 카탈로그에서 사라진 id 는 걸러낸다(판매 종료 등).
  const products = ids
    .map((id) => getProduct(id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  if (products.length === 0) return null;

  async function remove(productId: string) {
    setIds((prev) => prev.filter((id) => id !== productId)); // 낙관적 제거
    try {
      await removeWish(userId, productId);
    } catch {
      setIds((prev) => (prev.includes(productId) ? prev : [productId, ...prev])); // 실패 → 원복
    }
  }

  return (
    <>
      <h2 className="mt-12 font-serif-kr text-lg text-ink">찜한 제품</h2>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {products.map((p) => {
          const live = mergeProduct(p, map.get(p.id));
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-2xl border border-line bg-cream p-3"
            >
              <Link
                href={`/products/${p.id}`}
                className="relative h-16 w-14 shrink-0 overflow-hidden rounded-xl bg-paper-2"
              >
                <Image
                  src={p.image}
                  alt={`${p.name} ${p.volume}`}
                  fill
                  sizes="56px"
                  className="object-contain p-1.5"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/products/${p.id}`} className="block truncate text-[14px] text-ink hover:text-gold-deep">
                  {p.name} <span className="text-[12.5px] text-gold-deep">{p.volume}</span>
                </Link>
                <p className="mt-0.5 text-[13px] tabular-nums text-ink-soft">
                  {formatKRW(live.price)}
                  {live.soldOut && <span className="ml-1.5 text-mute">품절</span>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="shrink-0 text-[12.5px] text-mute underline transition-colors hover:text-ink"
              >
                해제
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
