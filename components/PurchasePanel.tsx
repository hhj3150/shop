"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import {
  type Product,
  type SubPeriod,
  PRODUCTS,
  SUB_PERIODS,
  PERIOD_LABEL,
  PERIOD_BADGE,
  formatKRW,
  subscribePrice,
  discountForPeriod,
  periodWeeks,
  SUB_SHIPPING_KRW,
  subShippingFee,
} from "@/lib/products";
import { useCart, DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";
import { getDayCounts, remaining, isWaitlisted, type DayCounts } from "@/lib/subscriptions";
import { firstSubscriptionDelivery, formatDispatch } from "@/lib/ship-date";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct, visibleProducts } from "@/lib/storefront-merge";
import { track } from "@/lib/track";

export function PurchasePanel({ product }: { product: Product }) {
  const { add, setPeriod } = useCart();
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>("mon");
  const [period, setPeriodLocal] = useState<SubPeriod>(2); // 8주 기본('인기')
  const [qty, setQty] = useState(1);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<DayCounts | null>(null);
  // 배송 요일을 고르면 "그 요일에 배송(=다음 날 수령)"임을 팝업으로 명확히 안내하고
  //   확인을 받는다. 바탕 글씨로는 놓치는 분들이 있어 모달로 한 번 짚어 준다.
  const [showShipNotice, setShowShipNotice] = useState(false);
  // 모바일 하단 고정 '담기' 바 — 메인 담기 버튼이 화면 밖으로 나가면 노출한다.
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    getDayCounts().then(setCounts);
  }, []);

  // 메인 담기 버튼의 화면 노출 여부를 관찰 — 보이지 않을 때만 하단 바를 띄운다.
  useEffect(() => {
    const el = addBtnRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      // 버튼을 '지나쳐 위로 스크롤한' 경우(top < 0)에만 띄운다. 아직 도달 전(아래)엔 숨김.
      ([entry]) =>
        setShowStickyBar(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 하단 담기 바가 떠 있는 동안엔 고객 채팅 FAB가 겹치지 않도록 신호를 보낸다.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("shop:addbar", { detail: showStickyBar }));
  }, [showStickyBar]);
  // 페이지 이탈(언마운트) 시 FAB를 반드시 복구.
  useEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent("shop:addbar", { detail: false }));
    },
    []
  );

  const { map, loading: catalogLoading } = useStorefrontCatalog();
  const liveMain = mergeProduct(product, map.get(product.id));
  // 함께 담을 수 있는 다른 제품들(같은 요일 배송). hidden 제외, 본품 제외.
  //   이름을 addons로 유지해 가격합·담기·렌더 사용처가 한 번에 라이브로 갱신된다.
  const addons = visibleProducts(PRODUCTS, map).filter((p) => p.id !== product.id);

  const rate = discountForPeriod(period);
  const weeks = periodWeeks(period);

  const unitPrice = subscribePrice(liveMain.price, rate);
  const mainPerDelivery = unitPrice * qty;
  const extrasPerDelivery = addons.reduce(
    (sum, p) => sum + subscribePrice(p.price, rate) * (extras[p.id] ?? 0),
    0
  );
  const perDelivery = mainPerDelivery + extrasPerDelivery;

  // 할인 전(정가) 회당 상품 합계 — 정가 대비 할인 표기용.
  const origPerDelivery =
    liveMain.price * qty +
    addons.reduce((sum, p) => sum + p.price * (extras[p.id] ?? 0), 0);
  const shipPerDelivery = subShippingFee(perDelivery);
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
    track("add_to_cart");
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

  // 판매 중지(active=false) 상품은 구매 영역을 안내로 대체한다(스펙 §5.2).
  //   목록에서 이미 숨겨져 정상 동선에선 도달하지 않지만, 직접 링크 진입에 대비.
  //   로딩 중엔 hidden=false(정적 폴백)이라 패널이 먼저 그려진 뒤 전환된다.
  if (liveMain.hidden) {
    return (
      <div className="rounded-3xl border border-line bg-cream p-8 sm:p-10">
        <EmptyState
          icon={<path d="M12 7.5v5l3 1.8 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />}
          title="지금은 판매하지 않는 상품입니다"
          description="더 좋은 모습으로 다시 찾아뵙겠습니다. 다른 제품을 둘러봐 주세요."
        />
      </div>
    );
  }

  return (
    <>
    <div className="rounded-3xl border border-line bg-cream p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <p className="text-[13px] uppercase tracking-[0.2em] text-gold-deep">
          Members Only · 창립 500인 특권
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
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border py-2.5 text-[14px] transition-all active:scale-[0.98] ${
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

      {/* 배송 요일 (매주 1회 고정) */}
      <div className="mt-7">
        <StepLabel n={2} title="택배 발송 요일" hint="도착일 아님 · 보통 다음 날 수령" />
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {DELIVERY_DAYS.map((d) => {
          const c = counts?.[d] ?? null;
          const rem = c ? remaining(c) : null;
          const full = c ? isWaitlisted(c) : false;
          return (
            <button
              key={d}
              onClick={() => {
                setDeliveryDay(d);
                setShowShipNotice(true);
              }}
              aria-pressed={deliveryDay === d}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border py-2.5 text-[14px] transition-all active:scale-[0.98] ${
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
      {showShipNotice && (
        <ShipNoticeModal
          day={DELIVERY_DAY_LABEL[deliveryDay]}
          firstDelivery={formatDispatch(firstDelivery)}
          onConfirm={() => setShowShipNotice(false)}
        />
      )}
      {selected &&
        (selectedFull ? (
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-gold/8 px-3 py-2.5 text-[13px] text-ink-soft">
            <svg className="mt-0.5 shrink-0 text-gold-deep" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M12 8v5M12 16h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              {DELIVERY_DAY_LABEL[deliveryDay]} 정원 마감 — 신청 시{" "}
              <span className="font-medium text-ink">대기자</span>로 등록됩니다.
            </span>
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-ink-soft">
            {DELIVERY_DAY_LABEL[deliveryDay]} ·{" "}
            <span className="font-medium text-gold-deep">{selectedRemaining}자리</span>{" "}
            남음 (현재 {selected.taken}번째까지 모집)
          </p>
        ))}

      {/* 수량 (매주 회당) */}
      <div className="mt-7 flex items-center justify-between">
        <StepLabel n={3} title="회당 수량" />
        <div className="flex items-center rounded-full border border-line">
          <button
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
            aria-label="수량 감소"
          >
            −
          </button>
          <span className="min-w-8 text-center text-sm tabular-nums text-ink">{qty}</span>
          <button
            onClick={() => setQty((q) => q + 1)}
            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
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
          다른 제품도 같은 요일에 함께 발송됩니다.
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
                  <p className="truncate text-[14px] text-ink">{p.name}</p>
                  <p className="mt-0.5 text-[12px] tabular-nums text-gold-deep">
                    <span className="font-medium">{p.volume}</span> · {formatKRW(ep)} / 회
                    {p.soldOut && <span className="ml-1.5 text-mute">품절</span>}
                  </p>
                </div>
                <div className="flex items-center rounded-full border border-line">
                  <button
                    onClick={() => setExtraQty(p.id, eq - 1)}
                    disabled={eq === 0}
                    className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90 disabled:opacity-30"
                    aria-label={`${p.name} 수량 감소`}
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-[14px] tabular-nums text-ink">
                    {eq}
                  </span>
                  <button
                    onClick={() => setExtraQty(p.id, eq + 1)}
                    disabled={p.soldOut}
                    className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90 disabled:opacity-30"
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
              배송비 {formatKRW(SUB_SHIPPING_KRW)} / 회
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
              {formatKRW(shipTotal)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
            <span className="text-[13px] text-mute">한 번에 입금</span>
            <span className="font-serif-kr text-xl text-ink tabular-nums">
              {formatKRW(periodTotal)}
            </span>
          </div>
        </div>

        <button
          ref={addBtnRef}
          onClick={handleAdd}
          disabled={catalogLoading || liveMain.soldOut}
          className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
        >
          {liveMain.soldOut ? "품절" : catalogLoading ? "확인 중…" : "구독 담기"}
        </button>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          매주 {DELIVERY_DAY_LABEL[deliveryDay]} 배송 · {PERIOD_LABEL[period]}분({weeks}회)
          한 번에 무통장입금 확인 후 발송
        </p>
      </div>
    </div>

    {/* 모바일 하단 고정 담기 바 — 메인 버튼이 화면 밖일 때만. BottomNav(68px) 위에 스택. */}
    {showStickyBar && !liveMain.hidden && (
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+68px)] z-30 border-t border-line bg-cream/95 px-5 py-2.5 backdrop-blur-sm md:hidden no-print">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11.5px] text-mute">
              매주 {DELIVERY_DAY_LABEL[deliveryDay]} · {PERIOD_LABEL[period]}분
            </p>
            <p className="font-serif-kr text-lg leading-tight text-ink tabular-nums">
              {formatKRW(perDelivery)}
              <span className="ml-1 text-[12px] font-sans text-mute">/ 회</span>
            </p>
          </div>
          <button
            onClick={handleAdd}
            disabled={catalogLoading || liveMain.soldOut}
            className="shrink-0 rounded-full bg-ink px-7 py-3 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
          >
            {liveMain.soldOut ? "품절" : catalogLoading ? "확인 중…" : "구독 담기"}
          </button>
        </div>
      </div>
    )}
    </>
  );
}

// 배송 요일 안내 팝업 — 선택한 요일이 '받는 날'이 아니라 '배송(발송) 날'임을 짚어 주고
//   확인을 받는다. 택배 특성상 보통 다음 날 수령임을 함께 안내해 오해를 줄인다.
function ShipNoticeModal({
  day,
  firstDelivery,
  onConfirm,
}: {
  day: string;
  firstDelivery: string;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-5"
      onClick={onConfirm}
      role="dialog"
      aria-modal="true"
      aria-label="배송 안내"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-cream p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="eyebrow text-gold-deep">배송 안내</p>
        <h3 className="mt-2 font-serif-kr text-xl text-ink">
          매주 <span className="text-gold-deep">{day}</span>에 발송됩니다
        </h3>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">
          선택하신 <span className="font-medium text-ink">{day}</span>은 <span className="font-medium text-ink">발송(배송 출발)</span>하는 날이에요.
          택배 특성상 보통 <span className="font-medium text-ink">다음 날 받으십니다.</span>
        </p>
        <p className="mt-2 rounded-xl bg-paper-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft">
          첫 배송은 <span className="font-medium text-gold-deep">{firstDelivery}</span>부터예요.
          전날 자정까지 입금이 확인되면 가장 가까운 {day}부터 시작됩니다.
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="mt-5 w-full rounded-full bg-ink py-3 text-[14px] font-medium text-cream transition-colors hover:bg-gold-deep"
        >
          확인했어요
        </button>
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
