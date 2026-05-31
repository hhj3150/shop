"use client";

import {
  CASH_RECEIPT_OPTIONS,
  cashReceiptOption,
  type CashReceiptType,
} from "@/lib/cash-receipt";

type Props = {
  type: CashReceiptType;
  id: string;
  onTypeChange: (type: CashReceiptType) => void;
  onIdChange: (id: string) => void;
};

// 현금영수증 발행 방식 선택 + 식별번호 입력. 무통장입금 주문에서 사용.
export function CashReceiptFields({ type, id, onTypeChange, onIdChange }: Props) {
  const opt = cashReceiptOption(type);
  const needsId = type !== "발행안함";

  return (
    <fieldset className="rounded-2xl border border-line bg-cream p-5">
      <legend className="px-1 text-[13px] font-medium tracking-wide text-ink-soft">
        현금영수증
      </legend>

      <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="현금영수증 발행 방식">
        {CASH_RECEIPT_OPTIONS.map((o) => {
          const active = o.value === type;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onTypeChange(o.value)}
              className={`rounded-xl border px-3 py-2.5 text-[14px] font-medium transition-colors ${
                active
                  ? "border-gold-deep bg-gold/10 text-gold-deep"
                  : "border-line text-ink-soft hover:border-gold/60"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-mute">{opt.hint}</p>

      {needsId && (
        <label htmlFor="cash-receipt-id" className="mt-3 block">
          <span className="block text-[13px] font-medium tracking-wide text-ink-soft">
            {opt.idLabel}
          </span>
          <input
            id="cash-receipt-id"
            inputMode="numeric"
            autoComplete="off"
            value={id}
            placeholder={opt.placeholder}
            onChange={(e) => onIdChange(e.target.value)}
            className="mt-2 w-full rounded-xl border border-line bg-cream px-4 py-3 text-[16px] tabular-nums text-ink outline-none transition-colors placeholder:text-mute/60 focus:border-gold"
          />
        </label>
      )}
    </fieldset>
  );
}
