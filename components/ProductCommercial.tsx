"use client";

// 상세 페이지 상업 가드: 라이브 가격 라인 + 숨김(active=false) 시 판매중지 안내.
//   콘텐츠(SSG)는 서버에서 그대로 렌더하고, 가격/노출만 이 컴포넌트가 클라이언트에서 보정.
import { useEffect, useState } from "react";
import {
  DEFAULT_SUB_PERIOD,
  PERIOD_LABEL,
  SUB_PERIODS,
  discountForPeriod,
  formatKRW,
  subscribePrice,
  type Product,
  type SubPeriod,
} from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct } from "@/lib/storefront-merge";

export function ProductHeroPrice({ product, maxRate }: { product: Product; maxRate: number }) {
  const { map } = useStorefrontCatalog();
  const live = mergeProduct(product, map.get(product.id));
  // 구매 패널에서 고른 기간을 그대로 따라간다(PurchasePanel 이 'shop:subperiod' 로 알린다).
  //   예전에는 여기만 '최대 할인(12주)' 값을 보여 줘서, 바로 아래 패널(기본 8주)의 값과
  //   어긋났다 — 같은 병이 한 화면에서 10,200원이기도 하고 10,560원이기도 했다.
  const [period, setPeriod] = useState<SubPeriod>(DEFAULT_SUB_PERIOD);
  const [mode, setMode] = useState<"sub" | "once">("sub");
  useEffect(() => {
    const onPeriod = (e: Event) => {
      const next = (e as CustomEvent).detail as SubPeriod;
      if (SUB_PERIODS.includes(next)) setPeriod(next);
    };
    // 구매 방식(정기구독 | 1회 구매)도 패널을 따라간다.
    const onMode = (e: Event) => setMode((e as CustomEvent).detail === "once" ? "once" : "sub");
    window.addEventListener("shop:subperiod", onPeriod);
    window.addEventListener("shop:buymode", onMode);
    return () => {
      window.removeEventListener("shop:subperiod", onPeriod);
      window.removeEventListener("shop:buymode", onMode);
    };
  }, []);
  const memberPrice = subscribePrice(live.price, discountForPeriod(period));
  const minRate = Math.round(discountForPeriod(SUB_PERIODS[0]) * 100);

  // 1회 구매 전용 제품 — 구독 회원가가 없으니 정가만 단정하게.
  if (product.onceOnly) {
    return (
      <div className="mt-4">
        <p className="text-[11px] tracking-wide text-mute">정가 · 1회 구매</p>
        <div className="mt-1 flex items-baseline justify-center gap-2.5 lg:justify-start">
          <p className="text-[clamp(1.5rem,4vw,1.9rem)] font-semibold leading-none text-ink lining-nums tabular-nums">
            {formatKRW(live.price)}
          </p>
        </div>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          <span className="inline-flex items-center rounded-full bg-label-green/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-label-green lining-nums">
            구독 없이 한 번만 · 회원가입 없이 구매 가능
          </span>
          {live.soldOut && <span className="text-[13px] text-mute">· 품절</span>}
        </p>
      </div>
    );
  }

  // 1회 구매 탭 — 정가가 대표 가격이다. 정기구독으로 사면 얼마인지는 한 줄로만 알린다.
  if (mode === "once") {
    return (
      <div className="mt-4">
        <p className="text-[11px] tracking-wide text-mute">1회 구매 · 정가</p>
        <div className="mt-1 flex items-baseline justify-center gap-2.5 lg:justify-start">
          <p className="text-[clamp(1.5rem,4vw,1.9rem)] font-semibold leading-none text-ink lining-nums tabular-nums">
            {formatKRW(live.price)}
            <span className="ml-1.5 align-baseline text-[13.5px] font-normal text-mute">/ 병</span>
          </p>
        </div>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
          <span className="inline-flex items-center rounded-full bg-label-green/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-label-green lining-nums">
            회원가입 없이 한 번만 · 정기구독은 {formatKRW(subscribePrice(live.price, maxRate / 100))}부터
          </span>
          {live.soldOut && <span className="text-[13px] text-mute">· 품절</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* 이 가격이 '정기구독' 회원가임을 명시 — 옆 단품구매 CTA와 혼동 방지 */}
      <p className="text-[11px] tracking-wide text-mute">정기구독 회원가 · {PERIOD_LABEL[period]} 기준</p>
      {/* 가격 — 회원가를 앞세우고 정가는 취소선으로 가치 대비를 즉시 인지 */}
      <div className="mt-1 flex items-baseline justify-center gap-2.5 lg:justify-start">
        <p className="text-[clamp(1.5rem,4vw,1.9rem)] font-semibold leading-none text-ink lining-nums tabular-nums">
          {formatKRW(memberPrice)}
          {/* 병 하나의 값이다. 예전 표기 '/ 회'는 '한 번 배송에 이 값'으로 읽혀, 2병이 기본인
              패널의 회당 금액(₩21,120)과 어긋났다. */}
          <span className="ml-1.5 align-baseline text-[13.5px] font-normal text-mute">/ 병</span>
        </p>
        <p className="text-[14px] text-mute line-through tabular-nums">{formatKRW(live.price)}</p>
      </div>
      {/* 회원 특권 — 브랜드 그린으로 적당히 강조 */}
      <p className="mt-2 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
        <span className="inline-flex items-center rounded-full bg-label-green/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-label-green lining-nums">
          창립 500인 회원 특권 · 기간별 −{minRate}~{maxRate}%
        </span>
        {live.soldOut && <span className="text-[13px] text-mute">· 품절</span>}
      </p>
    </div>
  );
}
