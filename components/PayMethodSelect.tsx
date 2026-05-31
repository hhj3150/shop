"use client";

import type { PayMethod } from "@/lib/portone";

// 결제수단 선택. PortOne 설정 시에만 노출한다(미설정이면 무통장 안내로 폴백).
//   - 가상계좌: 입금 즉시 자동 확인(웹훅) → 수동 입금확인 불필요.
//   - 카드 / 간편결제: 즉시 결제 완료.
const OPTIONS: { value: PayMethod; label: string; hint: string }[] = [
  { value: "VIRTUAL_ACCOUNT", label: "가상계좌", hint: "전용 계좌로 입금하면 자동 확인" },
  { value: "CARD", label: "카드", hint: "신용·체크카드 즉시 결제" },
  { value: "EASY_PAY", label: "간편결제", hint: "카카오페이·네이버페이 등" },
];

export function PayMethodSelect({
  value,
  onChange,
}: {
  value: PayMethod;
  onChange: (m: PayMethod) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
        결제수단
      </legend>
      <div className="grid grid-cols-3 gap-2">
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
