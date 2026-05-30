"use client";

import { useState } from "react";
import {
  type Product,
  formatKRW,
  subscribePrice,
  SUBSCRIBE_DISCOUNT,
} from "@/lib/products";
import { useCart, FREQUENCY_LABEL, type Frequency, type PurchaseMode } from "@/lib/cart";

const FREQUENCIES: Frequency[] = ["weekly", "biweekly", "monthly"];

export function PurchasePanel({ product }: { product: Product }) {
  const { add } = useCart();
  const [mode, setMode] = useState<PurchaseMode>("sub");
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [qty, setQty] = useState(1);

  const unitPrice = mode === "sub" ? subscribePrice(product.price) : product.price;
  const total = unitPrice * qty;

  const handleAdd = () => {
    add({
      productId: product.id,
      mode,
      frequency: mode === "sub" ? frequency : undefined,
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

      {/* Frequency (subscription only) */}
      {mode === "sub" && (
        <div className="mt-6">
          <p className="text-[12px] uppercase tracking-[0.18em] text-mute">배송 주기</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {FREQUENCIES.map((f) => (
              <button
                key={f}
                onClick={() => setFrequency(f)}
                className={`rounded-xl border py-2.5 text-[13px] transition-all ${
                  frequency === f
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-line text-ink-soft hover:border-gold/50"
                }`}
              >
                {FREQUENCY_LABEL[f]}
              </button>
            ))}
          </div>
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
            <p className="font-serif-kr text-2xl text-ink tabular-nums">{formatKRW(total)}</p>
          </div>
          <p className="text-[12px] text-ink-soft">
            {mode === "sub" ? (
              <>
                {FREQUENCY_LABEL[frequency]} 배송 · <span className="text-gold-deep">배송비 무료</span>
              </>
            ) : (
              "1회 결제"
            )}
          </p>
        </div>

        <button
          onClick={handleAdd}
          className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
        >
          {mode === "sub" ? "구독 담기" : "장바구니 담기"}
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          {mode === "sub"
            ? "첫 배송 후 선택한 주기로 자동 결제 · 언제든 건너뛰기 · 해지 가능"
            : "콜드체인 직배송 · 출고 후 1–2일 내 수령"}
        </p>
      </div>
    </div>
  );
}
