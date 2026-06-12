"use client";

import { BUSINESS, FARM_HOURS } from "@/lib/site";
import type { DeliveryMethod } from "@/lib/delivery-method";

// 택배/방문수령 선택 + 방문수령 안내. 단품·구독 결제 공용.
export function DeliveryMethodSelect({
  value,
  onChange,
}: {
  value: DeliveryMethod;
  onChange: (m: DeliveryMethod) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {(["택배", "방문수령"] as const).map((m) => {
          const active = value === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              aria-pressed={active}
              className={`rounded-xl border px-4 py-3 text-[14px] transition-colors ${
                active
                  ? "border-gold bg-gold/10 text-gold-deep"
                  : "border-line bg-cream text-ink-soft hover:border-gold/50"
              }`}
            >
              {m === "택배" ? "택배 배송" : "방문수령 (배송비 무료)"}
            </button>
          );
        })}
      </div>

      {value === "방문수령" && (
        <div className="rounded-xl border border-line bg-paper-2/40 p-4 text-[13.5px] leading-relaxed text-ink-soft">
          <p className="font-medium text-ink">🏠 방문수령 안내 — 송영신목장 판매장</p>
          <dl className="mt-2 space-y-1">
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-mute">주소</dt>
              <dd>{BUSINESS.address}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-mute">운영</dt>
              <dd>{FARM_HOURS}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-mute">문의</dt>
              <dd>
                {BUSINESS.tel} · {BUSINESS.mobile}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-mute">
            입금이 확인되면 안내된 수령 가능일부터 목장에서 받으실 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
