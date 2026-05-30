"use client";

import { useState } from "react";
import {
  type Product,
  formatKRW,
  subscribePrice,
  BASE_DISCOUNT,
  SUB_MIN_DELIVERIES,
  BLOCK_WEEKS,
} from "@/lib/products";
import { useCart, DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";

export function PurchasePanel({ product }: { product: Product }) {
  const { add } = useCart();
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>("mon");
  const [qty, setQty] = useState(1);

  const unitPrice = subscribePrice(product.price);
  const perDelivery = unitPrice * qty;
  const blockTotal = perDelivery * BLOCK_WEEKS;

  const handleAdd = () => {
    add({ productId: product.id, deliveryDay, qty, unitPrice });
  };

  return (
    <div className="rounded-3xl border border-line bg-cream p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.2em] text-gold-deep">
          Members Only · 정기구독
        </p>
        <span className="rounded-full bg-gold/12 px-3 py-1 text-[11px] font-medium text-gold-deep">
          −{Math.round(BASE_DISCOUNT * 100)}%
        </span>
      </div>

      {/* 배송 요일 (매주 1회 고정) */}
      <p className="mt-6 text-[12px] uppercase tracking-[0.18em] text-mute">
        배송 요일 · 매주
      </p>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
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
            {DELIVERY_DAY_LABEL[d].charAt(0)}
          </button>
        ))}
      </div>

      {/* 수량 (매주 회당) */}
      <div className="mt-6 flex items-center justify-between">
        <p className="text-[12px] uppercase tracking-[0.18em] text-mute">회당 수량</p>
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

      {/* 금액 */}
      <div className="mt-7 border-t border-line pt-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[13px] text-mute line-through tabular-nums">
              {formatKRW(product.price * qty)} / 회
            </p>
            <p className="font-serif-kr text-2xl text-ink tabular-nums">
              {formatKRW(perDelivery)}
              <span className="ml-1 text-[13px] font-sans text-mute">/ 회</span>
            </p>
          </div>
          <p className="text-right text-[12px] text-ink-soft">
            매주 {DELIVERY_DAY_LABEL[deliveryDay]}
            <br />
            <span className="text-gold-deep">배송비 무료</span>
          </p>
        </div>

        <p className="mt-2 text-[11px] text-mute">
          {product.taxFree ? "면세품 · 부가세 없음" : "과세품 · 부가세 포함 가격"}
        </p>

        <p className="mt-1 text-[12px] text-ink-soft tabular-nums">
          {BLOCK_WEEKS}주분({SUB_MIN_DELIVERIES}회) 선입금 기준{" "}
          <span className="font-semibold text-ink">{formatKRW(blockTotal)}</span>
        </p>

        <button
          onClick={handleAdd}
          className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
        >
          구독 담기
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          매주 {DELIVERY_DAY_LABEL[deliveryDay]} 배송 · {BLOCK_WEEKS}주 단위 입금 확인 후 발송 ·
          최소 {SUB_MIN_DELIVERIES}회
        </p>
      </div>
    </div>
  );
}
