"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  type Product,
  type SubPeriod,
  PRODUCTS,
  SUB_PERIODS,
  PERIOD_LABEL,
  formatKRW,
  subscribePrice,
  discountForPeriod,
  periodWeeks,
  SUB_SHIPPING_KRW,
  FREE_SHIP_KRW,
  subShippingFee,
} from "@/lib/products";
import { useCart, DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";
import { getDayCounts, remaining, isWaitlisted, type DayCounts } from "@/lib/subscriptions";
import { firstSubscriptionDelivery, formatDispatch } from "@/lib/ship-date";

export function PurchasePanel({ product }: { product: Product }) {
  const { add, setPeriod } = useCart();
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>("mon");
  const [period, setPeriodLocal] = useState<SubPeriod>(1);
  const [qty, setQty] = useState(1);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<DayCounts | null>(null);

  useEffect(() => {
    getDayCounts().then(setCounts);
  }, []);

  // 함께 담을 수 있는 다른 제품들(같은 요일 배송).
  const addons = PRODUCTS.filter((p) => p.id !== product.id);

  const rate = discountForPeriod(period);
  const weeks = periodWeeks(period);

  const unitPrice = subscribePrice(product.price, rate);
  const mainPerDelivery = unitPrice * qty;
  const extrasPerDelivery = addons.reduce(
    (sum, p) => sum + subscribePrice(p.price, rate) * (extras[p.id] ?? 0),
    0
  );
  const perDelivery = mainPerDelivery + extrasPerDelivery;

  // 무료배송 판정은 할인 전(정가) 회당 상품 합계로 한다.
  const origPerDelivery =
    product.price * qty +
    addons.reduce((sum, p) => sum + p.price * (extras[p.id] ?? 0), 0);
  const shipPerDelivery = subShippingFee(origPerDelivery);
  const freeShip = origPerDelivery > 0 && shipPerDelivery === 0;
  const toFreeShip = Math.max(0, FREE_SHIP_KRW - origPerDelivery);
  const shipTotal = shipPerDelivery * weeks;
  const periodTotal = perDelivery * weeks + shipTotal;
  const origPeriodTotal = origPerDelivery * weeks;

  const selected = counts?.[deliveryDay] ?? null;
  const selectedRemaining = selected ? remaining(selected) : null;
  const selectedFull = selected ? isWaitlisted(selected) : false;
  const firstDelivery = firstSubscriptionDelivery(deliveryDay);

  const setExtraQty = (id: string, q: number) =>
    setExtras((prev) => ({ ...prev, [id]: Math.max(0, q) }));

  const handleAdd = () => {
    setPeriod(period);
    add({ productId: product.id, deliveryDay, qty });
    addons.forEach((p) => {
      const eq = extras[p.id] ?? 0;
      if (eq > 0) {
        add({ productId: p.id, deliveryDay, qty: eq });
      }
    });
    setExtras({});
  };

  return (
    <div className="rounded-3xl border border-line bg-cream p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <p className="text-[13px] uppercase tracking-[0.2em] text-gold-deep">
          Members Only · 정기구독
        </p>
        <span className="rounded-full bg-gold/12 px-3 py-1 text-[12px] font-medium text-gold-deep">
          −{Math.round(rate * 100)}%
        </span>
      </div>

      {/* 구독 기간 — 전체 기간분을 한 번에 입금 */}
      <div className="mt-7">
        <StepLabel n={1} title="구독 기간" hint="선택한 기간만큼 한 번에 입금" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {SUB_PERIODS.map((m) => {
          const active = period === m;
          return (
            <button
              key={m}
              onClick={() => setPeriodLocal(m)}
              aria-pressed={active}
              className={`flex flex-col items-center rounded-xl border py-2 text-[14px] transition-all ${
                active
                  ? "border-gold bg-gold/10 text-ink"
                  : "border-line text-ink-soft hover:border-gold/50"
              }`}
            >
              <span>{PERIOD_LABEL[m]}</span>
              <span className="mt-0.5 text-[10px] tabular-nums text-gold-deep">
                −{Math.round(discountForPeriod(m) * 100)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* 배송 요일 (매주 1회 고정) */}
      <div className="mt-7">
        <StepLabel n={2} title="배송 요일" hint="매주 · 요일별 100명 한정" />
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {DELIVERY_DAYS.map((d) => {
          const c = counts?.[d] ?? null;
          const rem = c ? remaining(c) : null;
          const full = c ? isWaitlisted(c) : false;
          return (
            <button
              key={d}
              onClick={() => setDeliveryDay(d)}
              aria-pressed={deliveryDay === d}
              className={`flex flex-col items-center rounded-xl border py-2 text-[14px] transition-all ${
                deliveryDay === d
                  ? "border-gold bg-gold/10 text-ink"
                  : "border-line text-ink-soft hover:border-gold/50"
              }`}
            >
              <span>{DELIVERY_DAY_LABEL[d].charAt(0)}</span>
              <span
                className={`mt-0.5 text-[10px] tabular-nums ${
                  full ? "text-mute" : "text-gold-deep"
                }`}
              >
                {rem === null ? "·" : full ? "마감" : `${rem}석`}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 rounded-xl bg-paper-2 px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
        지금 신청하시면 첫 배송은{" "}
        <span className="font-medium text-gold-deep">{formatDispatch(firstDelivery)}</span>
        부터예요. 전날 자정까지 입금 확인되면 다음 {DELIVERY_DAY_LABEL[deliveryDay]}부터,
        그 뒤로는 매주 {DELIVERY_DAY_LABEL[deliveryDay]}에 받으십니다.
      </p>
      {selected && (
        <p className="mt-2 text-[13px] text-ink-soft">
          {selectedFull ? (
            <>
              {DELIVERY_DAY_LABEL[deliveryDay]} 정원 마감 — 신청 시{" "}
              <span className="font-medium text-ink">대기자</span>로 등록됩니다.
            </>
          ) : (
            <>
              {DELIVERY_DAY_LABEL[deliveryDay]} ·{" "}
              <span className="font-medium text-gold-deep">{selectedRemaining}자리</span>{" "}
              남음 (현재 {selected.taken}번째까지 모집)
            </>
          )}
        </p>
      )}

      {/* 수량 (매주 회당) */}
      <div className="mt-7 flex items-center justify-between">
        <StepLabel n={3} title="회당 수량" />
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

      {/* 함께 담기 — 같은 요일에 다른 제품도 추가 */}
      <div className="mt-7 border-t border-line pt-6">
        <StepLabel n={4} title="함께 담기" hint="같은 요일 배송" />
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
          다른 제품도 같은 요일에 함께 받으실 수 있습니다.
        </p>
        <ul className="mt-4 space-y-3">
          {addons.map((p) => {
            const ep = subscribePrice(p.price, rate);
            const eq = extras[p.id] ?? 0;
            return (
              <li key={p.id} className="flex items-center gap-3">
                <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    fill
                    sizes="40px"
                    className="object-contain p-1"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-ink">
                    {p.name} {p.volume}
                  </p>
                  <p className="mt-0.5 text-[12px] tabular-nums text-gold-deep">
                    {formatKRW(ep)} / 회
                  </p>
                </div>
                <div className="flex items-center rounded-full border border-line">
                  <button
                    onClick={() => setExtraQty(p.id, eq - 1)}
                    disabled={eq === 0}
                    className="px-3 py-1.5 text-mute transition-colors hover:text-ink disabled:opacity-30"
                    aria-label={`${p.name} 수량 감소`}
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-[14px] tabular-nums text-ink">
                    {eq}
                  </span>
                  <button
                    onClick={() => setExtraQty(p.id, eq + 1)}
                    className="px-3 py-1.5 text-mute transition-colors hover:text-ink"
                    aria-label={`${p.name} 수량 증가`}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 금액 */}
      <div className="mt-7 border-t border-line pt-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[14px] text-mute line-through tabular-nums">
              {formatKRW(origPerDelivery)} / 회
            </p>
            <p className="font-serif-kr text-2xl text-ink tabular-nums">
              {formatKRW(perDelivery)}
              <span className="ml-1 text-[14px] font-sans text-mute">/ 회</span>
            </p>
          </div>
          <p className="text-right text-[13px] text-ink-soft">
            매주 {DELIVERY_DAY_LABEL[deliveryDay]}
            <br />
            <span className="text-gold-deep">
              {freeShip ? "배송비 무료" : `배송비 ${formatKRW(SUB_SHIPPING_KRW)} / 회`}
            </span>
          </p>
        </div>

        <p className="mt-2 text-[12px] text-mute">
          {product.taxFree ? "면세품 · 부가세 없음" : "과세품 · 부가세 포함 가격"}
        </p>

        <div className="mt-3 rounded-2xl bg-paper-2 px-4 py-3">
          <div className="flex items-center justify-between text-[13px] text-ink-soft">
            <span>
              상품 {PERIOD_LABEL[period]} · 매주 {weeks}회
            </span>
            <span className="text-[12px] text-mute line-through tabular-nums">
              {formatKRW(origPeriodTotal)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between text-[13px] text-ink-soft">
            <span>배송비 ({weeks}회)</span>
            <span className="tabular-nums">
              {freeShip ? "무료" : formatKRW(shipTotal)}
            </span>
          </div>
          {!freeShip && (
            <p className="mt-1 text-[11.5px] text-gold-deep">
              회당 {formatKRW(toFreeShip)} 더 담으면 배송비 무료
            </p>
          )}
          <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
            <span className="text-[13px] text-mute">한 번에 입금</span>
            <span className="font-serif-kr text-xl text-ink tabular-nums">
              {formatKRW(periodTotal)}
            </span>
          </div>
        </div>

        <button
          onClick={handleAdd}
          className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
        >
          구독 담기
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          매주 {DELIVERY_DAY_LABEL[deliveryDay]} 배송 · {PERIOD_LABEL[period]}분({weeks}회)
          한 번에 무통장입금 확인 후 발송
        </p>
      </div>
    </div>
  );
}

// 애플 구매 페이지식 단계(STEP) 헤더 — 번호 + 제목 + 짧은 보조설명.
function StepLabel({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-semibold tabular-nums text-gold-deep">
        {n}
      </span>
      <span className="text-[15px] font-medium text-ink">{title}</span>
      {hint && <span className="text-[12px] text-mute">{hint}</span>}
    </div>
  );
}
