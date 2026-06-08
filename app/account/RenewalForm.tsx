"use client";

// 구독 연장 신청 폼 — 품목·회차수·배송 요일을 바꿔 재입금 신청한다.
//   "그대로 연장"은 프리필 값을 그대로 제출하면 된다(별도 분기 없음).
//   실제 할인·금액·좌석은 서버(request_renewal)가 권위 재계산한다 — 여기 견적은 미리보기다.
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  PRODUCTS,
  SUB_PERIODS,
  PERIOD_LABEL,
  PERIOD_BADGE,
  SUB_SHIPPING_KRW,
  formatKRW,
  subscribePrice,
  discountForPeriod,
  MIN_ORDER_KRW,
  type SubPeriod,
} from "@/lib/products";
import {
  DELIVERY_DAY_LABEL,
  DELIVERY_DAYS,
  type DeliveryDay,
} from "@/lib/cart";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct, visibleProducts, type LiveProduct } from "@/lib/storefront-merge";
import {
  getDayCounts,
  remaining,
  isWaitlisted,
  type DayCounts,
  type MySubscription,
} from "@/lib/subscriptions";
import { renewalQuote } from "@/lib/subscription-timeline";
import {
  prefillFormItems,
  buildRenewalItems,
  usedDeliveryDays,
  type FormItem,
} from "@/lib/renewal-form";

type Props = {
  sub: MySubscription;
  subs: readonly MySubscription[];
  busy: boolean;
  onSubmit: (args: {
    items: { product_id: string; qty: number }[];
    period: SubPeriod;
    deliveryDay: DeliveryDay;
  }) => void;
  onCancel: () => void;
};

// 기존 periodMonths 가 허용 기간(1/2/3)이면 그대로, 아니면 1(4주)로 기본.
function defaultPeriod(periodMonths: number): SubPeriod {
  return SUB_PERIODS.includes(periodMonths as SubPeriod)
    ? (periodMonths as SubPeriod)
    : 1;
}

export function RenewalForm({ sub, subs, busy, onSubmit, onCancel }: Props) {
  const { map, loading: catalogLoading } = useStorefrontCatalog();
  const [period, setPeriod] = useState<SubPeriod>(defaultPeriod(sub.periodMonths));
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>(sub.deliveryDay);
  const [counts, setCounts] = useState<DayCounts | null>(null);
  // productId → qty. 프리필은 카탈로그 로드와 무관하므로(정적 PRODUCTS 매칭) 즉시 채운다.
  const [qtyById, setQtyById] = useState<Record<string, number>>(() =>
    prefillFormItems(sub).reduce<Record<string, number>>(
      (acc, it) => ({ ...acc, [it.productId]: it.qty }),
      {}
    )
  );

  useEffect(() => {
    getDayCounts().then(setCounts).catch(() => setCounts(null));
  }, []);

  // 노출 상품만(숨김 제외). 카탈로그 로드 전엔 정적 가격 폴백.
  const products: LiveProduct[] = useMemo(
    () => visibleProducts(PRODUCTS, map),
    [map]
  );

  const rate = discountForPeriod(period);

  // 회원이 다른 활성 슬롯에서 쓰는 요일(현재 슬롯 제외) — 비활성 처리.
  const blockedDays = useMemo(
    () => usedDeliveryDays(subs, sub.slotId),
    [subs, sub.slotId]
  );

  const formItems: FormItem[] = useMemo(
    () =>
      Object.entries(qtyById).map(([productId, qty]) => ({ productId, qty })),
    [qtyById]
  );

  // 견적 — 카탈로그 정가에 기간 할인 적용(서버가 권위 재계산, C2).
  //   특수배송지역(제주 5,000) 여부는 클라이언트에서 확실히 알 수 없어 일반 4,000 으로 미리보기한다.
  const quote = useMemo(() => {
    const priceOf = (id: string) => {
      const p = PRODUCTS.find((x) => x.id === id);
      return p ? mergeProduct(p, map.get(id)).price : 0;
    };
    const quoteItems = formItems
      .filter((it) => it.qty > 0)
      .map((it) => ({ listPrice: priceOf(it.productId), qty: it.qty }));
    return renewalQuote(quoteItems, period, SUB_SHIPPING_KRW);
  }, [formItems, period, map]);

  const items = buildRenewalItems(formItems);
  const hasItems = items.length > 0;
  const canSubmit = hasItems && !quote.belowMin && !busy && !catalogLoading;

  const setQty = (id: string, qty: number) =>
    setQtyById((prev) => ({ ...prev, [id]: Math.max(0, qty) }));

  const selected = counts?.[deliveryDay] ?? null;
  const selectedFull = selected ? isWaitlisted(selected) : false;

  return (
    <div className="rounded-2xl bg-paper-2 p-4">
      <p className="text-[14px] font-medium text-ink">구독 연장 신청</p>
      <p className="mt-1 text-[12px] leading-relaxed text-mute">
        품목·요일·회차수를 바꿔 신청하실 수 있어요. 그대로 두고 신청하면 같은 구성으로 이어집니다.
      </p>

      {/* 회차수 */}
      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink">회차수</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {SUB_PERIODS.map((m) => {
            const active = period === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setPeriod(m)}
                aria-pressed={active}
                className={`flex min-h-11 flex-col items-center justify-center rounded-xl border py-2.5 text-[14px] transition-all ${
                  active
                    ? "border-gold bg-gold/10 text-ink"
                    : "border-line text-ink-soft hover:border-gold/50"
                }`}
              >
                {PERIOD_BADGE[m] && (
                  <span className="mb-0.5 rounded-full bg-gold/15 px-1.5 py-px text-[9px] font-medium leading-tight text-gold-deep">
                    {PERIOD_BADGE[m]}
                  </span>
                )}
                <span>{PERIOD_LABEL[m]}</span>
                <span className="mt-0.5 text-[10px] tabular-nums text-gold-deep">
                  −{Math.round(discountForPeriod(m) * 100)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 배송 요일 */}
      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink">배송 요일</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {DELIVERY_DAYS.map((d) => {
            const c = counts?.[d] ?? null;
            const rem = c ? remaining(c) : null;
            const full = c ? isWaitlisted(c) : false;
            const isCurrent = d === sub.deliveryDay;
            // 현재 요일은 항상 선택 가능. 그 외엔 만석/본인 점유 요일 비활성.
            const disabled = !isCurrent && (full || blockedDays.has(d));
            const active = deliveryDay === d;
            return (
              <button
                key={d}
                type="button"
                disabled={disabled}
                onClick={() => setDeliveryDay(d)}
                aria-pressed={active}
                className={`flex min-h-11 flex-col items-center justify-center rounded-xl border py-2.5 text-[14px] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
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
                  {blockedDays.has(d) && !isCurrent
                    ? "사용중"
                    : rem === null
                      ? "·"
                      : full
                        ? "마감"
                        : `${rem}석`}
                </span>
              </button>
            );
          })}
        </div>
        {selected && selectedFull && deliveryDay !== sub.deliveryDay && (
          <p className="mt-2 text-[12px] text-ink-soft">
            {DELIVERY_DAY_LABEL[deliveryDay]} 정원 마감 — 신청 시 대기자로 등록됩니다.
          </p>
        )}
      </div>

      {/* 품목 편집 */}
      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink">품목</p>
        <ul className="mt-2 space-y-3">
          {products.map((p) => {
            const ep = subscribePrice(p.price, rate);
            const q = qtyById[p.id] ?? 0;
            return (
              <li key={p.id} className="flex items-center gap-3">
                <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-cream">
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
                    {p.soldOut && <span className="ml-1.5 text-mute">품절</span>}
                  </p>
                </div>
                <div className="flex items-center rounded-full border border-line">
                  <button
                    type="button"
                    onClick={() => setQty(p.id, q - 1)}
                    disabled={q === 0}
                    className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-colors hover:text-ink disabled:opacity-30"
                    aria-label={`${p.name} 수량 감소`}
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-[14px] tabular-nums text-ink">
                    {q}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQty(p.id, q + 1)}
                    disabled={p.soldOut && q === 0}
                    className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-colors hover:text-ink disabled:opacity-30"
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

      {/* 실시간 견적 */}
      <div className="mt-5 rounded-xl bg-cream px-4 py-3">
        <div className="flex items-center justify-between text-[13px] text-ink-soft">
          <span>회당 상품 ({PERIOD_LABEL[period]} · 매주 {quote.weeks}회)</span>
          <span className="tabular-nums text-ink">
            {formatKRW(quote.unitTotalPerDelivery)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[13px] text-ink-soft">
          <span>할인</span>
          <span className="tabular-nums text-gold-deep">
            −{Math.round(rate * 100)}%
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[13px] text-ink-soft">
          <span>배송비 ({quote.weeks}회)</span>
          <span className="tabular-nums">{formatKRW(quote.shipping)}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
          <span className="text-[13px] text-mute">한 번에 입금</span>
          <span className="font-serif-kr text-xl text-ink tabular-nums">
            {formatKRW(quote.total)}
          </span>
        </div>
      </div>

      {!hasItems && (
        <p className="mt-3 text-[12px] text-mute">
          연장하실 품목을 한 가지 이상 담아 주세요.
        </p>
      )}
      {hasItems && quote.belowMin && (
        <p className="mt-3 rounded-xl bg-gold/10 px-3 py-2.5 text-[12px] leading-relaxed text-gold-deep">
          회당 상품 합계가 최소 {formatKRW(MIN_ORDER_KRW)} 이상이어야 신청할 수 있어요.
          수량을 늘리거나 품목을 추가해 주세요.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit({ items, period, deliveryDay })}
          disabled={!canSubmit}
          className="flex-1 rounded-full bg-ink py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
        >
          {busy ? "처리 중…" : "연장 신청하고 입금 안내 받기"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-line px-5 py-2.5 text-[14px] text-ink-soft transition-colors hover:border-gold disabled:opacity-50"
        >
          닫기
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-mute">
        입금이 확인되면 선택한 요일·구성으로 이어집니다. 최종 금액·할인·자리 배정은 입금 안내
        시점에 확정됩니다.
      </p>
    </div>
  );
}
