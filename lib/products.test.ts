import { describe, it, expect } from "vitest";
import {
  SUB_PERIODS,
  PERIOD_LABEL,
  PERIOD_DISCOUNT,
  PERIOD_BADGE,
  discountForPeriod,
  periodWeeks,
  subscribePrice,
  subShippingFee,
  BASE_DISCOUNT,
  MIN_ORDER_KRW,
  ONCE_MIN_KRW,
  PUBLIC_PRODUCTS,
  getProduct,
  getPublicProduct,
  type SubPeriod,
  minFillQty,
  DEFAULT_SUB_PERIOD,
  PRODUCTS,
} from "./products";

describe("회당 최소 결제금액 정책", () => {
  // 750mL 1병 12,000원 × 2병 = 24,000원이 통과되도록 24,000원으로 설정.
  it("단품·구독 회당 최소금액은 24,000원", () => {
    expect(MIN_ORDER_KRW).toBe(24000);
    expect(ONCE_MIN_KRW).toBe(24000);
  });
  it("750mL 2병(24,000원)은 충족, 1병(12,000원)은 미달", () => {
    const bottle = 12000;
    expect(bottle * 2 >= ONCE_MIN_KRW).toBe(true);
    expect(bottle * 1 >= ONCE_MIN_KRW).toBe(false);
  });
});

describe("미공개(unpublished) 제품 노출 차단", () => {
  it("애프터밀크는 출시 전이라 미공개", () => {
    expect(getProduct("aftermilk-1l")?.unpublished).toBe(true);
  });

  it("PUBLIC_PRODUCTS에서 미공개 제품은 빠진다", () => {
    expect(PUBLIC_PRODUCTS.every((p) => !p.unpublished)).toBe(true);
    expect(PUBLIC_PRODUCTS.find((p) => p.id === "aftermilk-1l")).toBeUndefined();
  });

  it("PRODUCTS(관리자·ERP·과거주문 매칭용)에는 그대로 남는다", () => {
    expect(PRODUCTS.find((p) => p.id === "aftermilk-1l")).toBeDefined();
  });

  it("getPublicProduct는 미공개 제품을 없는 것으로 취급(상세 404)", () => {
    expect(getPublicProduct("aftermilk-1l")).toBeUndefined();
    expect(getPublicProduct(PUBLIC_PRODUCTS[0].id)?.id).toBe(PUBLIC_PRODUCTS[0].id);
  });
});

describe("정기구독 기간 옵션", () => {
  it("SUB_PERIODS는 1·2·3·6(4/8/12/24주) 네 단계", () => {
    expect(SUB_PERIODS).toEqual([1, 2, 3, 6]);
  });

  it("PERIOD_LABEL은 주 단위 라벨", () => {
    expect(PERIOD_LABEL[1]).toBe("4주");
    expect(PERIOD_LABEL[2]).toBe("8주");
    expect(PERIOD_LABEL[3]).toBe("12주");
    expect(PERIOD_LABEL[6]).toBe("24주");
  });

  it("PERIOD_DISCOUNT는 10/12/15/20%", () => {
    expect(PERIOD_DISCOUNT[1]).toBe(0.10);
    expect(PERIOD_DISCOUNT[2]).toBe(0.12);
    expect(PERIOD_DISCOUNT[3]).toBe(0.15);
    expect(PERIOD_DISCOUNT[6]).toBe(0.20);
  });

  it("PERIOD_BADGE: 8주=인기, 24주=최대 할인, 4·12주=없음", () => {
    expect(PERIOD_BADGE[2]).toBe("인기");
    expect(PERIOD_BADGE[6]).toBe("최대 할인");
    expect(PERIOD_BADGE[1]).toBeUndefined();
    expect(PERIOD_BADGE[3]).toBeUndefined();
  });

  it("BASE_DISCOUNT은 4주(10%) 유지 — 상품카드 회원가 기준 불변", () => {
    expect(BASE_DISCOUNT).toBe(0.10);
  });
});

describe("discountForPeriod / periodWeeks", () => {
  it("discountForPeriod는 모든 기간에서 number 반환(undefined 아님)", () => {
    for (const m of SUB_PERIODS) {
      expect(typeof discountForPeriod(m)).toBe("number");
    }
  });

  it("discountForPeriod 값", () => {
    expect(discountForPeriod(1)).toBe(0.10);
    expect(discountForPeriod(2)).toBe(0.12);
    expect(discountForPeriod(3)).toBe(0.15);
    expect(discountForPeriod(6)).toBe(0.20);
  });

  it("periodWeeks = 개월*4", () => {
    expect(periodWeeks(1)).toBe(4);
    expect(periodWeeks(2)).toBe(8);
    expect(periodWeeks(3)).toBe(12);
    expect(periodWeeks(6)).toBe(24);
  });
});

describe("기간별 입금 합계 산식(대표 1품목: 정가 12,000 × 3병)", () => {
  // 서버 create_subscription_order와 동일 산식을 클라 순수함수로 재현:
  //   병당 = round(price*(1-rate)/10)*10, 회당 = 병당*qty,
  //   total = 회당*weeks + (4000*weeks).  배송비는 항상 자부담.
  // 주의: 클라(Math.round, 반올림)와 서버(Postgres round, 5는 올림)는 .5 경계에서만 갈린다.
  //   아래 3개 정가는 경계에 닿지 않아 일치. 금액 권위는 어디까지나 서버다(이 테스트는 재현일 뿐).
  const price = 12000;
  const qty = 3;
  const periodTotal = (m: SubPeriod): number => {
    const rate = discountForPeriod(m);
    const perDelivery = subscribePrice(price, rate) * qty;
    const weeks = periodWeeks(m);
    const ship = subShippingFee(perDelivery) * weeks;
    return perDelivery * weeks + ship;
  };

  it("4주(10%) → 145,600", () => {
    expect(periodTotal(1)).toBe(145600);
  });
  it("8주(12%) → 285,440", () => {
    expect(periodTotal(2)).toBe(285440);
  });
  it("12주(15%) → 415,200", () => {
    expect(periodTotal(3)).toBe(415200);
  });
  it("24주(20%) → 787,200", () => {
    // 병당 9,600 × 3 = 회당 28,800 → ×24 = 691,200 + 배송비 96,000
    expect(periodTotal(6)).toBe(787200);
  });

  // 금액의 권위는 서버다. 아래 표는 운영 DB 의 산식
  //   (round((price * (1 - rate)) / 10.0) * 10)::int 을 2026-11-11 에 직접 돌려 받은 값이다.
  //   3,500원·4,300원의 15% 는 10원 반올림의 .5 경계(2,975 · 3,655)에 걸리는데도 화면과
  //   서버가 같은 쪽으로 올린다 — 새 기간·새 정가를 넣을 때 이 표가 그 일치를 지킨다.
  it("화면의 병당 회원가는 서버 산식과 같다(정가 4종 × 기간 4종)", () => {
    const server: Record<number, [number, number, number, number]> = {
      3500: [3150, 3080, 2980, 2800],
      4300: [3870, 3780, 3660, 3440],
      10000: [9000, 8800, 8500, 8000],
      12000: [10800, 10560, 10200, 9600],
    };
    for (const [price, units] of Object.entries(server)) {
      SUB_PERIODS.forEach((m, i) => {
        expect(subscribePrice(Number(price), discountForPeriod(m)), `${price}원 · ${m}`).toBe(units[i]);
      });
    }
    // 표가 실제 판매 정가를 빠짐없이 덮는지 — 새 정가가 생기면 여기서 걸린다.
    for (const p of PRODUCTS.filter((x) => !x.onceOnly)) {
      expect(Object.keys(server).map(Number), `${p.id} 정가 ${p.price}`).toContain(p.price);
    }
  });
});

describe("구매 패널의 출발 수량 — 들어오자마자 살 수 있어야 한다", () => {
  // 1 로 시작하면 750mL 한 병(12,000원)이 최소금액에 못 미쳐 '바로 구매'가 죽은 채로 열린다.
  it("구독으로 파는 모든 제품의 출발 수량은 최소 주문금액을 채운다", () => {
    for (const p of PRODUCTS.filter((x) => !x.onceOnly)) {
      const q = minFillQty(p.price);
      expect(p.price * q, `${p.id}: 출발 수량이 최소금액 미달`).toBeGreaterThanOrEqual(MIN_ORDER_KRW);
      // 꼭 필요한 만큼만 — 한 병 덜어도 채워진다면 과하게 잡은 것이다.
      if (q > 1) expect(p.price * (q - 1)).toBeLessThan(MIN_ORDER_KRW);
    }
  });

  it("이미 같은 요일로 담아 둔 금액은 빼고 센다", () => {
    expect(minFillQty(12000, 0)).toBe(2);
    expect(minFillQty(12000, 12000)).toBe(1);
    expect(minFillQty(12000, 50000)).toBe(1); // 이미 채웠어도 0 병이 되지는 않는다
  });

  it("상세 상단 가격과 구매 패널은 같은 기간(8주)에서 출발한다", () => {
    expect(DEFAULT_SUB_PERIOD).toBe(2);
  });
});
