"use client";

import { useState } from "react";
import {
  type Product,
  formatKRW,
  subscribePrice,
  SUBSCRIBE_DISCOUNT,
  SUB_MIN_DELIVERIES,
} from "@/lib/products";
import {
  useCart,
  DELIVERY_DAY_LABEL,
  type DeliveryDay,
  type PurchaseMode,
} from "@/lib/cart";

const DELIVERY_DAYS: DeliveryDay[] = ["tue", "thu"];

export function PurchasePanel({ product }: { product: Product }) {
  const { add } = useCart();
  const [mode, setMode] = useState<PurchaseMode>("sub");
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>("tue");
  const [qty, setQty] = useState(1);

  const unitPrice = mode === "sub" ? subscribePrice(product.price) : product.price;
  const perDelivery = unitPrice * qty;
  const subCommitTotal = perDelivery * SUB_MIN_DELIVERIES;

  const handleAdd = () => {
    add({
      productId: product.id,
      mode,
      deliveryDay: mode === "sub" ? deliveryDay : undefined,
      qty,
      unitPrice,
    });
  };

  return (
    <div className="rounded-3xl border border-line bg-cream p-6 sm:p-8">
      {/* Mode toggle */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-paper-2 p-1.5">
        {(["sub", "one"] as PurchaseMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-3 text-sm font-medium transition-all ${
              mode === m ? "bg-cream text-ink shadow-sm" : "text-mute hover:text-ink"
            }`}
          >
            {m === "sub" ? "정기구독" : "1회 구매"}
            {m === "sub" && (
              <span className="ml-1.5 text-[11px] text-gold-deep">
                −{Math.round(SUBSCRIBE_DISCOUNT * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Subscription: delivery day + commitment */}
      {mode === "sub" && (
        <div className="mt-6">
          <p className="text-[12px] uppercase tracking-[0.18em] text-mute">배송 요일</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DELIVERY_DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDeliveryDay(d)}
                aria-pressed={deliveryDay === d}
                className={`rounded-xl border py-2.5 text-[13px] transition-all ${
                  deliveryDay === d
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-line text-ink-soft hover:border-gold/50"
                }`}
              >
                매주 {DELIVERY_DAY_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="mt-3 rounded-xl bg-paper-2 px-4 py-3 text-[12px] leading-relaxed text-ink-soft">
            주 1회 배송 · 한 번 신청하면{" "}
            <span className="font-semibold text-ink">최소 {SUB_MIN_DELIVERIES}회</span> 받는
            구독이에요.
          </p>
        </div>
      )}

      {/* Single purchase: delivery rule */}
      {mode === "one" && (
        <div className="mt-6 rounded-xl bg-paper-2 px-4 py-3 text-[12px] leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">익일 배송</span> · 월–금 수령
          <br />
          전날 밤 <span className="font-semibold text-ink">12시</span>까지 주문하면 다음 날
          받아보실 수 있어요.
        </div>
      )}

      {/* Quantity */}
      <div className="mt-6 flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.18em] text-mute">수량</p>
        <div className="flex items-center rounded-full border border-line">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="px-4 py-2 text-mute transition-colors hover:text-ink"
            aria-label="수량 감소"
          >
            −
          </button>
          <span className="min-w-8 text-center text-sm tabular-nums text-ink">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="px-4 py-2 text-mute transition-colors hover:text-ink"
            aria-label="수량 증가"
          >
            +
          </button>
        </div>
      </div>

      {/* Price summary */}
      <div className="mt-7 border-t border-line pt-6">
        <div className="flex items-end justify-between">
          <div>
            {mode === "sub" && (
              <p className="text-[13px] text-mute line-through tabular-nums">
                {formatKRW(product.price * qty)}
              </p>
            )}
            <p className="font-serif-kr text-2xl text-ink tabular-nums">
              {formatKRW(perDelivery)}
              {mode === "sub" && (
                <span className="ml-1 text-[13px] font-sans text-mute">/ 회</span>
              )}
            </p>
          </div>
          <p className="text-right text-[12px] text-ink-soft">
            {mode === "sub" ? (
              <>
                매주 {DELIVERY_DAY_LABEL[deliveryDay]} ·{" "}
                <span className="text-gold-deep">배송비 무료</span>
              </>
            ) : (
              "1회 결제"
            )}
          </p>
        </div>

        <p className="mt-2 text-[11px] text-mute">
          {product.taxFree ? "면세품 · 부가세 없음" : "과세품 · 부가세 포함 가격"}
        </p>

        {mode === "sub" && (
          <p className="mt-1 text-[12px] text-mute tabular-nums">
            {SUB_MIN_DELIVERIES}회 약정 기준 총 {formatKRW(subCommitTotal)}
          </p>
        )}

        <button
          onClick={handleAdd}
          className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
        >
          {mode === "sub" ? "구독 담기" : "장바구니 담기"}
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          {mode === "sub"
            ? `매주 ${DELIVERY_DAY_LABEL[deliveryDay]} 자동 결제·배송 · 최소 ${SUB_MIN_DELIVERIES}회 이후 해지 가능`
            : "콜드체인 직배송 · 익일 수령 (월–금)"}
        </p>
      </div>
    </div>
  );
}
