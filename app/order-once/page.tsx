import Image from "next/image";
import Link from "next/link";
import { ONCE_MIN_KRW, ONCE_SHIPPING_KRW, formatKRW } from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import { livePublicProducts } from "@/lib/seo/live-catalog";
import type { LiveProduct } from "@/lib/storefront-merge";
import OrderOnceClient from "./OrderOnceClient";

// 단품 주문 — 서버가 소개(제목·주문 조건·제품과 가격)를 그리고, 주문서는 클라이언트(OrderOnceClient)가 그린다.
//   가격은 DB(product_catalog) 값 — 메타 설명·구조화데이터와 같은 출처(lib/seo/live-catalog.ts).
export const revalidate = 3600;

export default async function OrderOncePage() {
  const products = await livePublicProducts();
  return <OrderOnceClient staticView={<OrderOnceIntro products={products} />} />;
}

// 주문서 머리글(OrderOnceClient 의 제목·안내문)과 같은 모양 — 넘어갈 때 화면이 튀지 않게.
function OrderOnceIntro({ products }: { products: LiveProduct[] }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">Single Order · 단품 구매</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        한 번만, 골라 담기
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        구독 없이, 원하는 것만 한 번. 회원이 아니어도 주문하실 수 있습니다. 상품 합계{" "}
        <span className="text-ink-soft">{formatKRW(ONCE_MIN_KRW)} 이상</span> · 배송비{" "}
        {formatKRW(ONCE_SHIPPING_KRW)}(제주·도서산간 등 {formatKRW(SPECIAL_DELIVERY_SHIPPING_KRW)}).{" "}
        <br className="hidden sm:block" />
        평일(월–목) 자정 전 주문은 다음 날, 금·토·일 주문은 월요일 발송. (발송 월–금)
      </p>

      <ul className="mt-8 space-y-3">
        {products.map((p) => (
          <li key={p.id} className="flex items-center gap-4 rounded-2xl border border-line bg-cream p-4">
            <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-paper">
              <Image
                src={p.image}
                alt={`${p.name} ${p.volume}`}
                fill
                sizes="56px"
                className="object-contain p-1"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] text-ink">{p.name}</p>
              <p className="mt-0.5 text-[13px] tabular-nums text-gold-deep">
                <span className="font-medium">{p.volume}</span> · {formatKRW(p.price)}
                {p.soldOut && <span className="ml-1.5 text-mute">· 품절</span>}
              </p>
            </div>
            <Link
              href={`/products/${p.id}`}
              className="shrink-0 text-[13px] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              자세히
            </Link>
          </li>
        ))}
      </ul>

      <p role="status" className="mt-6 text-center text-[13px] text-mute">
        주문서를 불러오는 중…
      </p>
    </div>
  );
}
