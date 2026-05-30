"use client";

import Image from "next/image";
import { useCart, DELIVERY_DAY_LABEL, FREQUENCY_LABEL } from "@/lib/cart";
import { getProduct, formatKRW } from "@/lib/products";

export function CartDrawer() {
  const { items, isOpen, close, subtotal, setQty, remove } = useCart();

  const hasSub = items.some((i) => i.mode === "sub");

  return (
    <>
      <div
        onClick={close}
        className={`fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm transition-opacity duration-500 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!isOpen}
      />

      <aside
        className={`fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-cream shadow-2xl transition-transform duration-500 ease-[var(--ease-soft)] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="장바구니"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 className="font-serif-kr text-lg text-ink">장바구니</h2>
          <button
            onClick={close}
            aria-label="닫기"
            className="text-mute transition-colors hover:text-ink"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="font-serif-kr text-base text-ink-soft">담긴 제품이 없습니다.</p>
              <p className="mt-2 text-sm text-mute">목장에서 갓 짜낸 한 병을 담아보세요.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const p = getProduct(item.productId);
                if (!p) return null;
                return (
                  <li key={item.key} className="flex gap-4 py-5">
                    <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                      <Image
                        src={p.image}
                        alt={p.name}
                        fill
                        sizes="64px"
                        className="object-contain p-1.5"
                      />
                    </div>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {p.name} {p.volume}
                          </p>
                          <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-gold-deep">
                            {item.mode === "sub"
                              ? `정기구독 · ${FREQUENCY_LABEL[item.frequency ?? "weekly"]} ${DELIVERY_DAY_LABEL[item.deliveryDay ?? "tue"]}`
                              : "1회 구매"}
                          </p>
                        </div>
                        <button
                          onClick={() => remove(item.key)}
                          aria-label="삭제"
                          className="text-mute transition-colors hover:text-ink"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center rounded-full border border-line">
                          <button
                            onClick={() => setQty(item.key, item.qty - 1)}
                            className="px-3 py-1 text-mute transition-colors hover:text-ink"
                            aria-label="수량 감소"
                          >
                            −
                          </button>
                          <span className="min-w-6 text-center text-sm tabular-nums text-ink">
                            {item.qty}
                          </span>
                          <button
                            onClick={() => setQty(item.key, item.qty + 1)}
                            className="px-3 py-1 text-mute transition-colors hover:text-ink"
                            aria-label="수량 증가"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-sm tabular-nums text-ink">
                          {formatKRW(item.unitPrice * item.qty)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-6 py-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-mute">합계</span>
              <span className="font-serif-kr text-xl text-ink tabular-nums">
                {formatKRW(subtotal)}
              </span>
            </div>
            {hasSub && (
              <p className="mt-2 text-[12px] leading-relaxed text-gold-deep">
                정기구독 상품이 포함되어 있어요. 선택한 주기·요일에 자동 결제·배송되며, 최소 4회
                이후 해지할 수 있습니다.
              </p>
            )}
            <button
              onClick={() =>
                alert(
                  "결제 단계입니다.\n\n실제 결제(포트원/토스 빌링키 정기결제)는 PG 계약·키 발급 후 이 지점에 연동됩니다.\n현재는 디자인 프로토타입입니다."
                )
              }
              className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
            >
              {hasSub ? "구독 시작하고 결제하기" : "결제하기"}
            </button>
            <p className="mt-3 text-center text-[11px] text-mute">
              안전한 결제 · 정기구독은 언제든 해지 가능
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
