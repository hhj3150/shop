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
  type SubPeriod,
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

describe("정기구독 기간 옵션", () => {
  it("SUB_PERIODS는 1·2·3(4/8/12주) 세 단계", () => {
    expect(SUB_PERIODS).toEqual([1, 2, 3]);
  });

  it("PERIOD_LABEL은 주 단위 라벨", () => {
    expect(PERIOD_LABEL[1]).toBe("4주");
    expect(PERIOD_LABEL[2]).toBe("8주");
    expect(PERIOD_LABEL[3]).toBe("12주");
  });

  it("PERIOD_DISCOUNT는 10/12/15%", () => {
    expect(PERIOD_DISCOUNT[1]).toBe(0.10);
    expect(PERIOD_DISCOUNT[2]).toBe(0.12);
    expect(PERIOD_DISCOUNT[3]).toBe(0.15);
  });

  it("PERIOD_BADGE: 8주=인기, 12주=최대 할인, 4주=없음", () => {
    expect(PERIOD_BADGE[2]).toBe("인기");
    expect(PERIOD_BADGE[3]).toBe("최대 할인");
    expect(PERIOD_BADGE[1]).toBeUndefined();
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
  });

  it("periodWeeks = 개월*4", () => {
    expect(periodWeeks(1)).toBe(4);
    expect(periodWeeks(2)).toBe(8);
    expect(periodWeeks(3)).toBe(12);
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
});
