"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { VacationNotice } from "@/components/VacationNotice";
import {
  type Product,
  type SubPeriod,
  PRODUCTS,
  SUB_PERIODS,
  DEFAULT_SUB_PERIOD,
  minFillQty,
  discountRangeLabel,
  PERIOD_LABEL,
  PERIOD_BADGE,
  MIN_ORDER_KRW,
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  formatKRW,
  subscribePrice,
  discountForPeriod,
  periodWeeks,
  SUB_SHIPPING_KRW,
  subShippingFee,
} from "@/lib/products";
import { useCart, DELIVERY_DAY_LABEL, DELIVERY_DAYS, type DeliveryDay } from "@/lib/cart";
import { getDayCounts, remaining, isWaitlisted, type DayCounts } from "@/lib/subscriptions";
import { firstShipDateFor, formatDispatch, nextDispatchDate } from "@/lib/ship-date";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct, visibleProducts } from "@/lib/storefront-merge";
import { track } from "@/lib/track";

export function PurchasePanel({ product }: { product: Product }) {
  const router = useRouter();
  const { add, setPeriod, close, items } = useCart();
  const [deliveryDay, setDeliveryDay] = useState<DeliveryDay>("mon");
  const [period, setPeriodLocal] = useState<SubPeriod>(DEFAULT_SUB_PERIOD); // 8주 기본('인기')
  // 회당 수량 — 최소 주문금액(정가 24,000원)을 채우는 수량으로 시작한다(1회 구매와 같은 규칙).
  //   1 로 시작하면 750mL 한 병(12,000원)이 최소금액에 못 미쳐, 들어오자마자 '바로 구매'가
  //   회색으로 죽어 있고 경고문부터 읽게 된다. 정책은 그대로 두고 출발점만 맞춘다.
  const [qty, setQty] = useState(() => minFillQty(product.price));
  // 손님이 수량을 직접 만진 뒤에는 자동 보정이 덮어쓰지 않는다.
  const qtyTouchedRef = useRef(false);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [counts, setCounts] = useState<DayCounts | null>(null);
  // '함께 담기'는 기본 접힘 — 결정 단계를 줄여 핵심 구매 동선을 짧게 유지한다.
  const [extrasOpen, setExtrasOpen] = useState(false);
  // 구매 방식: 정기구독(기본·할인) | 1회 구매(정가). 처음 온 분은 1회로 부담 없이 시작.
  //   1회 구매 전용 제품(애프터밀크 등)은 구독 UI 없이 once로 고정한다.
  const [mode, setMode] = useState<"sub" | "once">(
    product.onceOnly ? "once" : "sub"
  );
  // 1회 구매 수량 — 최소 주문금액(정가 24,000원)을 채우는 수량으로 시작.
  //   1회 구매 전용 제품(애프터밀크)은 '우유와 함께 담기'가 기본 전략이라 1개로 시작
  //   (수량으로 최소금액을 채우게 하지 않고, 아래 안내가 우유 페어링을 권한다).
  const [onceQty, setOnceQty] = useState(() =>
    product.onceOnly ? 1 : Math.max(1, Math.ceil(ONCE_MIN_KRW / product.price))
  );
  // 주소에 ?mode=once 가 붙어 오면 1회 구매 탭으로 연다(홈·안내에서 '1회 구매'로 들어온 손님).
  //   정적으로 만들어 둔 화면이라 서버에서는 주소를 모른다 — 마운트 뒤에 한 번 맞춘다.
  useEffect(() => {
    if (product.onceOnly) return;
    if (new URLSearchParams(window.location.search).get("mode") === "once") setMode("once");
  }, [product.onceOnly]);
  // 사용자가 요일을 직접 고른 뒤에는 자동 추천이 선택을 덮어쓰지 않는다.
  const dayTouchedRef = useRef(false);
  // 모바일 하단 고정 구매 바 — 패널 안으로 들어왔는데 구매 버튼이 화면에 없을 때 노출한다.
  const panelRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);

  useEffect(() => {
    getDayCounts().then(setCounts);
  }, []);

  // 정기구독은 한 번에 한 배송요일만 신청할 수 있다(서버도 다요일 주문을 거절).
  //   장바구니에 이미 담긴 요일이 있으면 그 요일로 고정해, 고객이 서로 다른 요일을
  //   담았다가 결제 단계에서 막히는 일을 처음부터 방지한다(같은 요일만 선택 가능).
  const cartDay: DeliveryDay | null = items.length > 0 ? items[0].deliveryDay : null;
  useEffect(() => {
    if (cartDay) setDeliveryDay(cartDay);
  }, [cartDay]);

  // 여유 있는 요일 자동 추천 — 정원 현황이 로드되면 잔여석이 가장 많은 요일을 기본 선택한다
  //   (마감 요일이 기본으로 잡혀 대기자 신청이 되는 일 방지). 사용자가 직접 고른 뒤나
  //   장바구니 요일이 고정된 경우엔 덮어쓰지 않는다.
  useEffect(() => {
    if (!counts || dayTouchedRef.current || cartDay) return;
    let best: DeliveryDay = DELIVERY_DAYS[0];
    let bestRemaining = -1;
    for (const d of DELIVERY_DAYS) {
      const rem = remaining(counts[d]);
      if (rem > bestRemaining) {
        best = d;
        bestRemaining = rem;
      }
    }
    setDeliveryDay(best);
  }, [counts, cartDay]);

  // 하단 구매 바의 노출 판정.
  //   · 구매 버튼이 화면에 보이면 숨긴다(같은 버튼이 두 벌 보이지 않게).
  //   · 아직 패널에 닿지 않았으면(제품 사진·이름을 보는 중) 숨긴다 — 첫 화면은 제품만.
  //   · 패널을 고르는 중이거나 지나쳐 내려갔으면 띄운다 — 합계와 구매를 언제든 한 탭에.
  //   예전에는 '상단 가격을 지나면 뜨는 바'와 '담기 버튼을 지나면 뜨는 바' 두 벌이 따로
  //   있어서, 구매 버튼이 화면에 있는데도 바가 떠 있거나 두 바가 같은 자리에 겹쳤다.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const panel = panelRef.current?.getBoundingClientRect();
      const cta = ctaRef.current?.getBoundingClientRect();
      if (!panel || !cta) return setShowStickyBar(false);
      const vh = window.innerHeight;
      const ctaVisible = cta.top < vh - 72 && cta.bottom > 72;
      const reachedPanel = panel.top < vh * 0.4;
      setShowStickyBar(reachedPanel && !ctaVisible);
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mode]);

  // 하단 구매 바가 떠 있는 동안엔 고객 채팅 FAB가 겹치지 않도록 신호를 보낸다.
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

  // 고른 기간을 상세 상단 가격(ProductHeroPrice)에 알린다 — 위아래 값이 늘 같게.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("shop:subperiod", { detail: period }));
  }, [period]);

  const { map, loading: catalogLoading } = useStorefrontCatalog();
  const liveMain = mergeProduct(product, map.get(product.id));
  // 함께 담을 수 있는 다른 제품들(같은 요일 배송). hidden 제외, 본품 제외.
  //   1회 구매 전용 제품은 매주 반복 배송되는 구독 장바구니에 태울 수 없어 제외.
  //   이름을 addons로 유지해 가격합·담기·렌더 사용처가 한 번에 라이브로 갱신된다.
  const addons = visibleProducts(PRODUCTS, map).filter(
    (p) => p.id !== product.id && !p.onceOnly
  );

  const rate = discountForPeriod(period);
  const weeks = periodWeeks(period);

  const unitPrice = subscribePrice(liveMain.price, rate);
  const mainPerDelivery = unitPrice * qty;
  const extrasPerDelivery = addons.reduce(
    (sum, p) => sum + subscribePrice(p.price, rate) * (extras[p.id] ?? 0),
    0
  );
  const perDelivery = mainPerDelivery + extrasPerDelivery;
  // 접힌 '함께 담기'에 담긴 추가 제품 개수(접힘 상태 요약 표시용).
  const extrasCount = Object.values(extras).reduce((sum, n) => sum + n, 0);

  // 할인 전(정가) 회당 상품 합계 — 정가 대비 할인 표기용.
  const origPerDelivery =
    liveMain.price * qty +
    addons.reduce((sum, p) => sum + p.price * (extras[p.id] ?? 0), 0);

  // 최소주문(회당 정가 24,000원) 사전 판정 — 체크아웃에서야 막히지 않게 패널에서 미리 안내.
  //   같은 요일로 장바구니에 이미 담긴 항목까지 합쳐 '담은 후' 기준으로 계산한다
  //   (판정 기준은 서버·체크아웃과 동일하게 정가).
  const listPriceOf = (id: string) => {
    const p = PRODUCTS.find((x) => x.id === id);
    return p ? mergeProduct(p, map.get(id)).price : 0;
  };
  const cartListSameDay = items
    .filter((i) => i.deliveryDay === deliveryDay)
    .reduce((sum, i) => sum + listPriceOf(i.productId) * i.qty, 0);
  const projectedList = cartListSameDay + origPerDelivery;
  const belowMin = projectedList < MIN_ORDER_KRW;
  const minShort = MIN_ORDER_KRW - projectedList;

  // 같은 요일로 이미 담아 둔 것이 있으면 그만큼은 빼고 출발 수량을 잡는다
  //   (장바구니는 마운트 뒤에 복원되므로 여기서 한 번 더 맞춘다). 직접 만진 뒤엔 건드리지 않는다.
  const fitQty = minFillQty(liveMain.price, cartListSameDay);
  useEffect(() => {
    if (!qtyTouchedRef.current) setQty(fitQty);
  }, [fitQty]);
  const changeQty = (next: number) => {
    qtyTouchedRef.current = true;
    setQty(Math.max(1, next));
  };

  const shipPerDelivery = subShippingFee(perDelivery);
  const shipTotal = shipPerDelivery * weeks;
  const periodTotal = perDelivery * weeks + shipTotal;
  const origPeriodTotal = origPerDelivery * weeks;

  const selected = counts?.[deliveryDay] ?? null;
  const selectedRemaining = selected ? remaining(selected) : null;
  const selectedFull = selected ? isWaitlisted(selected) : false;
  // 첫 배송 '표시'는 실제 발송일로 — 공휴일이면 다음 영업일, 목장 휴무로 그 주가 통째로
  //   막히면 다음 주 같은 요일(computeSchedule 1회차·로스터와 동일 규칙).
  const firstDelivery = new Date(`${firstShipDateFor(deliveryDay)}T00:00:00`);

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

  // 바로 구매 — 담자마자 체크아웃으로. add()가 여는 드로어는 닫는다(체크아웃 위에 겹치지 않게).
  const handleBuyNow = () => {
    handleAdd();
    close();
    router.push("/checkout");
  };

  // ── 1회 구매(정가) 요약 — 서버(create_once_order)와 동일 규칙: 정가 합계 + 배송비.
  const oncePrice = liveMain.price;
  const onceSubtotal = oncePrice * onceQty;
  const onceBelowMin = onceSubtotal < ONCE_MIN_KRW;
  const onceShort = ONCE_MIN_KRW - onceSubtotal;
  const onceTotal = onceSubtotal + ONCE_SHIPPING_KRW;
  const onceDispatch = formatDispatch(nextDispatchDate());

  // 1회 구매 — 수량을 실어 단품 주문 페이지로(배송지·결제는 그 화면에서).
  const handleBuyOnce = () => {
    router.push(`/order-once?add=${product.id}&qty=${onceQty}`);
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
    <div ref={panelRef} className="rounded-3xl border border-line bg-cream p-6 sm:p-8">
      <VacationNotice className="mb-5" />
      {/* 구매 방식 탭 — 정기구독(할인) | 1회 구매(정가·비회원 가능).
          1회 구매 전용 제품은 탭 대신 안내 헤더만 노출한다. */}
      {product.onceOnly ? (
        <div className="rounded-full bg-paper-2 px-5 py-2.5 text-center text-[13.5px] font-medium text-ink">
          1회 구매 <span className="text-mute">· 구독 없이 부담 없이</span>
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-1 rounded-full bg-paper-2 p-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "sub"}
          onClick={() => setMode("sub")}
          className={`rounded-full py-2.5 text-[13.5px] font-medium transition-colors ${
            mode === "sub" ? "bg-cream text-ink shadow-sm" : "text-mute hover:text-ink"
          }`}
        >
          정기구독 <span className="text-gold-deep">−{discountRangeLabel()}%</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "once"}
          onClick={() => setMode("once")}
          className={`rounded-full py-2.5 text-[13.5px] font-medium transition-colors ${
            mode === "once" ? "bg-cream text-ink shadow-sm" : "text-mute hover:text-ink"
          }`}
        >
          1회 구매
        </button>
      </div>
      )}

      {mode === "sub" && (
      <>
      <div className="mt-6 flex items-center justify-between">
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
          // 장바구니에 담긴 요일이 있으면 그 요일만 선택 가능(나머지 비활성).
          const locked = cartDay !== null && cartDay !== d;
          return (
            <button
              key={d}
              disabled={locked}
              onClick={() => {
                dayTouchedRef.current = true;
                setDeliveryDay(d);
              }}
              aria-pressed={deliveryDay === d}
              className={`flex min-h-11 flex-col items-center justify-center rounded-xl border py-2.5 text-[14px] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
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
      {cartDay && (
        <p className="mt-2 rounded-xl bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
          이미 <span className="font-medium text-ink">{DELIVERY_DAY_LABEL[cartDay]}</span> 구독을 담으셨어요.
          정기구독은 한 번에 <span className="font-medium text-ink">한 요일</span>로만 신청돼요 — 다른 요일은 따로 신청해 주세요.
        </p>
      )}
      {/* 발송 안내 — 팝업 대신 인라인 한 줄: 선택 요일은 '발송일'이고 보통 다음 날 수령. */}
      <div className="mt-2 rounded-xl bg-paper-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
        매주 <span className="font-medium text-ink">{DELIVERY_DAY_LABEL[deliveryDay]}</span> 발송
        · 보통 <span className="font-medium text-ink">다음 날 수령</span> · 첫 배송{" "}
        <span className="font-medium text-gold-deep">{formatDispatch(firstDelivery)}</span>
        {selected &&
          (selectedFull ? (
            <>
              {" "}· <span className="font-medium text-ink">정원 마감 — 신청 시 대기자 등록</span>
            </>
          ) : (
            <>
              {" "}· 선착순 <span className="font-medium text-gold-deep">{selectedRemaining}자리</span> 남음
            </>
          ))}
      </div>

      {/* 수량 (매주 회당) */}
      <div className="mt-7 flex items-center justify-between">
        <StepLabel n={3} title="회당 수량" />
        <div className="flex items-center rounded-full border border-line">
          <button
            onClick={() => changeQty(qty - 1)}
            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
            aria-label="수량 감소"
          >
            −
          </button>
          <span className="min-w-8 text-center text-sm tabular-nums text-ink">{qty}</span>
          <button
            onClick={() => changeQty(qty + 1)}
            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
            aria-label="수량 증가"
          >
            +
          </button>
        </div>
      </div>

      {/* 함께 담기 — 같은 요일에 다른 제품도 추가. 기본 접힘(핵심 구매 동선을 짧게). */}
      <div className="mt-7 border-t border-line pt-6">
        <button
          type="button"
          onClick={() => setExtrasOpen((o) => !o)}
          aria-expanded={extrasOpen}
          className="-my-2.5 flex min-h-11 w-full items-center justify-between"
        >
          <StepLabel n={4} title="함께 담기" hint="같은 요일 배송 · 선택사항" />
          <svg
            className={`h-4 w-4 shrink-0 text-mute transition-transform duration-300 ${extrasOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {!extrasOpen && extrasCount > 0 && (
          <p className="mt-2 text-[12px] text-gold-deep">추가 제품 {extrasCount}개 담김</p>
        )}
        {extrasOpen && (
        <>
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
        </>
        )}
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

        {/* 고른 것을 한 문장으로 되읽어 준다 — 몇 병을, 언제, 몇 번, 지금 얼마.
            숫자 표만 있으면 손님이 조건을 머릿속에서 다시 조립해야 한다. */}
        <p className="t-footnote mt-4 leading-relaxed text-ink-soft" aria-live="polite">
          매주 <span className="font-medium text-ink">{DELIVERY_DAY_LABEL[deliveryDay]}</span>에{" "}
          <span className="font-medium text-ink">
            {liveMain.name} {liveMain.volume} {qty}개
            {extrasCount > 0 && ` + ${extrasCount}개`}
          </span>
          씩, <span className="font-medium text-ink">{weeks}번</span> 보내 드립니다. 지금 한 번에{" "}
          <span className="font-medium text-ink tabular-nums">{formatKRW(periodTotal)}</span>(배송비 포함)을
          입금하시면 됩니다.
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

        {/* 최소주문 사전 안내 — 결제 단계에서야 막히는 대신 여기서 미리(정가 기준, 장바구니 합산). */}
        {belowMin && (
          <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-gold-deep">
            회당 최소 상품금액은 정가 기준 {formatKRW(MIN_ORDER_KRW)}이에요.{" "}
            <span className="font-medium">{formatKRW(minShort)}</span>어치만 더 담으면 신청할 수
            있어요. (수량을 올리거나 함께 담기를 열어보세요)
          </p>
        )}

        <div ref={mode === "sub" ? ctaRef : undefined} className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            onClick={handleAdd}
            disabled={catalogLoading || liveMain.soldOut}
            className="rounded-full border border-ink/30 bg-cream py-4 text-sm font-medium tracking-wide text-ink transition-[transform,colors] hover:border-gold hover:text-gold-deep active:scale-[0.99] disabled:opacity-40"
          >
            {liveMain.soldOut ? "품절" : "구독 담기"}
          </button>
          <button
            onClick={handleBuyNow}
            disabled={catalogLoading || liveMain.soldOut || belowMin}
            className="rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
          >
            {liveMain.soldOut ? "품절" : catalogLoading ? "확인 중…" : "바로 구매"}
          </button>
        </div>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
          매주 {DELIVERY_DAY_LABEL[deliveryDay]} 배송 · {PERIOD_LABEL[period]}분({weeks}회)
          한 번에 무통장입금 확인 후 발송
        </p>
      </div>
      </>
      )}

      {mode === "once" && (
        <div>
          {/* 1회 구매 — 구독 없이 지금 구성 그대로 한 번만. 결정은 수량 하나뿐. */}
          <div className="mt-7 flex items-center justify-between">
            <StepLabel n={1} title="수량" hint="구독 없이 한 번만 배송" />
            <div className="flex items-center rounded-full border border-line">
              <button
                onClick={() => setOnceQty((q) => Math.max(1, q - 1))}
                className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
                aria-label="수량 감소"
              >
                −
              </button>
              <span className="min-w-8 text-center text-sm tabular-nums text-ink">{onceQty}</span>
              <button
                onClick={() => setOnceQty((q) => q + 1)}
                className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-[transform,colors] hover:text-ink active:scale-90"
                aria-label="수량 증가"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-paper-2 px-4 py-3">
            <div className="flex items-center justify-between text-[13px] text-ink-soft">
              <span>
                상품 (정가 {formatKRW(oncePrice)} × {onceQty})
              </span>
              <span className="tabular-nums">{formatKRW(onceSubtotal)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[13px] text-ink-soft">
              <span>
                배송비 <span className="text-[11.5px] text-mute">(제주·도서산간 5,000원)</span>
              </span>
              <span className="tabular-nums">{formatKRW(ONCE_SHIPPING_KRW)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5">
              <span className="text-[13px] text-mute">합계</span>
              <span className="font-serif-kr text-xl text-ink tabular-nums">
                {formatKRW(onceTotal)}
              </span>
            </div>
          </div>

          <p className="mt-2 text-[12px] text-mute">
            {product.taxFree ? "면세품 · 부가세 없음" : "과세품 · 부가세 포함 가격"} · 입금 확인
            시 {onceDispatch} 발송
          </p>

          {onceBelowMin &&
            (product.onceOnly ? (
              /* 애프터밀크 — 수량 채우기 대신 '우유와 함께'를 권한다(교차판매). */
              <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-gold-deep">
                단품 최소 주문금액은 {formatKRW(ONCE_MIN_KRW)}이에요.{" "}
                <span className="font-medium">우유와 함께 담아 보세요</span> — 예를 들어
                헤이밀크 750mL 2병과 함께면 채워져요. 다음 화면에서 함께 담을 수 있어요.
              </p>
            ) : (
              <p className="mt-4 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-gold-deep">
                단품 최소 주문금액은 {formatKRW(ONCE_MIN_KRW)}이에요. 수량을 올리거나, 다음
                화면에서 다른 제품을 <span className="font-medium">{formatKRW(onceShort)}</span>어치
                함께 담을 수 있어요.
              </p>
            ))}

          <div ref={mode === "once" ? ctaRef : undefined}>
          <button
            onClick={handleBuyOnce}
            disabled={catalogLoading || liveMain.soldOut}
            className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
          >
            {liveMain.soldOut ? "품절" : catalogLoading ? "확인 중…" : "1회 구매 계속하기"}
          </button>
          </div>
          <p className="mt-4 text-center text-[11.5px] leading-relaxed text-mute">
            다음 화면에서 배송지만 입력하면 완료 · 회원가입 없이도 구매 가능
          </p>
        </div>
      )}
    </div>

    {/* 모바일 하단 고정 구매 바 — 제품 상세에서는 전역 하단 탭바 대신 이 바 한 겹만 둔다
        (BottomNav 가 /products 에서 물러난다). 화면 맨 아래에 붙고 홈바 영역만큼 띄운다. */}
    {!liveMain.hidden && (
      <div
        aria-hidden={!showStickyBar}
        className={`material-chrome fixed inset-x-0 bottom-0 z-30 border-t border-line/70 px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] transition-[transform,opacity] duration-300 ease-[var(--ease-soft)] md:hidden no-print ${
          showStickyBar ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
        }`}
      >
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[11.5px] text-mute">
              {mode === "sub"
                ? `매주 ${DELIVERY_DAY_LABEL[deliveryDay]} · ${PERIOD_LABEL[period]}분`
                : "1회 구매 · 배송비 포함"}
            </p>
            <p className="font-serif-kr text-lg leading-tight text-ink tabular-nums">
              {formatKRW(mode === "sub" ? perDelivery : onceTotal)}
              {mode === "sub" && <span className="ml-1 text-[12px] font-sans text-mute">/ 회</span>}
            </p>
          </div>
          {mode === "sub" ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleAdd}
                tabIndex={showStickyBar ? 0 : -1}
                disabled={catalogLoading || liveMain.soldOut}
                className="min-h-11 rounded-full border border-ink/30 px-4 text-sm font-medium tracking-wide text-ink transition-colors hover:border-gold hover:text-gold-deep active:scale-[0.99] disabled:opacity-40"
              >
                담기
              </button>
              {belowMin ? (
                /* 최소금액 미달이면 죽은 버튼 대신, 고칠 수 있는 자리(수량)로 데려간다. */
                <a
                  href="#configure"
                  tabIndex={showStickyBar ? 0 : -1}
                  className="flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
                >
                  수량 채우기
                </a>
              ) : (
                <button
                  onClick={handleBuyNow}
                  tabIndex={showStickyBar ? 0 : -1}
                  disabled={catalogLoading || liveMain.soldOut}
                  className="min-h-11 rounded-full bg-ink px-5 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
                >
                  {liveMain.soldOut ? "품절" : "바로 구매"}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleBuyOnce}
              tabIndex={showStickyBar ? 0 : -1}
              disabled={catalogLoading || liveMain.soldOut}
              className="min-h-11 shrink-0 rounded-full bg-ink px-5 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep active:scale-[0.99] disabled:opacity-40 disabled:hover:bg-ink"
            >
              {liveMain.soldOut ? "품절" : "1회 구매 계속하기"}
            </button>
          )}
        </div>
      </div>
    )}
    </>
  );
}

// 애플 구매 페이지식 단계(STEP) 헤더 — 번호 + 제목 + 짧은 보조설명.
function StepLabel({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-semibold tabular-nums text-gold-deep">
        {n}
      </span>
      {/* 좁은 화면에서 제목이 두 줄로 쪼개지지 않게 — 넘치면 보조설명이 다음 줄로 내려간다. */}
      <span className="whitespace-nowrap text-[15px] font-medium text-ink">{title}</span>
      {hint && <span className="text-[12px] text-mute">{hint}</span>}
    </div>
  );
}
