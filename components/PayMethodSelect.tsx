"use client";

// 체크아웃 결제수단.
//   - BANK(무통장입금): 농협 계좌 직접입금 → PayAction 이 자동 매칭·확인.
//   - CARD: 나이스페이 결제창. 기본은 카드만, 간편결제 스위치(NICEPAY_EASYPAY)가 켜지면 카드+간편결제.
import { useEasyPayEnabled } from "@/lib/nicepay/client";

export type CheckoutMethod = "BANK" | "CARD";

const BANK = { value: "BANK" as const, label: "무통장입금", hint: "계좌로 입금하면 자동 확인됩니다" };
const CARD_ONLY = { value: "CARD" as const, label: "카드", hint: "신용·체크카드 즉시 결제" };
const CARD_EASY = { value: "CARD" as const, label: "카드/간편결제", hint: "신용·체크카드, 카카오페이·네이버페이 등 즉시 결제" };

export function PayMethodSelect({
  value,
  onChange,
}: {
  value: CheckoutMethod;
  onChange: (m: CheckoutMethod) => void;
}) {
  const OPTIONS = [BANK, useEasyPayEnabled() ? CARD_EASY : CARD_ONLY];
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
        결제수단
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`min-h-16 rounded-xl border px-3 py-2 text-center transition-colors ${
                active
                  ? "border-gold bg-gold/10 text-gold-deep"
                  : "border-line bg-cream text-ink-soft hover:border-gold/50"
              }`}
            >
              <span className="block text-[14px] font-medium">{opt.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[12.5px] leading-relaxed text-mute">
        {OPTIONS.find((o) => o.value === value)?.hint}
      </p>
    </fieldset>
  );
}
