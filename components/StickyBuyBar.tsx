"use client";

// 모바일 전용 하단 구매 바 — 히어로의 구매 CTA를 지나 스크롤하면 나타나
//   가격과 '정기구독 신청'을 언제든 한 탭에 둔다(우리는 구매사이트).
//   전역 하단 탭바(BottomNav) 위, 채팅 FAB(bottom-[84px])와 겹치지 않게 배치한다.
import { useEffect, useState } from "react";
import { formatKRW, subscribePrice, type Product } from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function StickyBuyBar({ product, maxRate }: { product: Product; maxRate: number }) {
  const { map } = useStorefrontCatalog();
  const live = mergeProduct(product, map.get(product.id));
  const memberPrice = subscribePrice(live.price, maxRate / 100);
  const [show, setShow] = useState(false);

  // 히어로 CTA(#hero-cta)가 화면에서 사라지면(스크롤로 지나가면) 바를 띄운다.
  useEffect(() => {
    const target = document.getElementById("hero-cta");
    if (!target) {
      setShow(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting), {
      rootMargin: "0px 0px -20% 0px",
    });
    io.observe(target);
    return () => io.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!show}
      className={`fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.9rem)] z-30 no-print transition-all duration-300 md:hidden ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {/* pr-20: 오른쪽 채팅 FAB 자리를 비워 버튼과 겹치지 않게 한다. */}
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 border-t border-line bg-paper/95 px-5 py-2.5 pr-20 shadow-[0_-8px_24px_-16px_rgba(40,30,15,0.35)] backdrop-blur">
        <div className="min-w-0">
          <p className="text-[11px] leading-none text-mute">정기구독 회원가</p>
          <p className="mt-1 text-[15px] font-semibold leading-none text-ink tabular-nums">
            {formatKRW(memberPrice)}
            <span className="ml-1 text-[12px] font-normal text-mute">/ 회</span>
          </p>
        </div>
        <a
          href="#configure"
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
        >
          정기구독 신청
        </a>
      </div>
    </div>
  );
}
