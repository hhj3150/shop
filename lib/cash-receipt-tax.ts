// 현금영수증 과세/면세 분리 계산.
//   정책(사업자 확인): 우유(헤이밀크)=면세, 요거트=과세. 판매가는 모두 '부가세 포함가'.
//   현금영수증은 면세금액과 과세분(공급가액+부가세)을 나눠 적어야 하므로, 주문 한 건을
//   품목별 면세/과세로 가른 뒤 과세분에서 부가세를 역산한다(포함가 ÷ 1.1).
//
//   ★ 구독 주문 주의: order_items 의 qty 는 '회당(매주 1회)' 수량이고 total_amount 는
//     전체 기간(4·8·12주)분이다. 반드시 weeks(orders.block_weeks)를 넘겨 품목합을
//     주수만큼 곱해야 한다 — 안 그러면 우유+요거트 혼합 구독에서 1주치를 뺀 전액이
//     '배송비'로 오인돼 과세로 잡힌다(부가세 과대·면세 과소).
//
//   배송비 귀속: '과세 품목이 하나도 없으면(전부 면세)' 부수용역으로 면세 처리,
//   그 외에는 과세 용역으로 처리한다. (세무 판단은 사업자 확인 권장)
//
//   적립금 등 차감: total(실결제액)이 품목합+배송비보다 작으면 차감액을 면세/과세에
//   비례 배분해 '면세 + 공급가액 + 부가세 = 실결제액' 불변식을 지킨다 — 현금영수증은
//   실제 받은 현금보다 크게 발행할 수 없다.
import { PRODUCTS } from "./products";

export type ReceiptItem = {
  productId: string;
  unitPrice: number; // 부가세 포함 단가
  qty: number; // 구독 주문은 회당(매주) 수량
};

// 주문 헤더에서 오는 보조 정보. 구독 주문은 반드시 weeks 를 넘겨야 한다.
export type ReceiptOrderInfo = {
  weeks?: number; // 배송 회수(orders.block_weeks). 단품·미지정 = 1
  shippingFee?: number; // 주문 총 배송비(orders.shipping_fee). 미지정 시 총액-품목합으로 추정
};

export type CashReceiptAmounts = {
  total: number; // 결제 총액 (= taxFreeAmount + supplyAmount + vat)
  taxFreeAmount: number; // 면세금액 (우유 등)
  supplyAmount: number; // 과세 공급가액 (부가세 제외)
  vat: number; // 부가세
};

// product_id → 면세 여부. 카탈로그에 있으면 그 값을, 없으면 'milk-' 접두사로 보수적 판단.
const TAXFREE_BY_ID = new Map<string, boolean>(PRODUCTS.map((p) => [p.id, p.taxFree]));

export function isTaxFreeProduct(productId: string): boolean {
  const known = TAXFREE_BY_ID.get(productId);
  if (known !== undefined) return known;
  return productId.startsWith("milk"); // 폴백: 우유 라인은 면세
}

// 주문(품목 + 결제 총액)을 면세/과세로 분리한다. 반환값의 세 항목 합은 항상 total 과 같다.
//   info.weeks: 구독은 orders.block_weeks(품목합 × 주수), 단품은 생략(=1).
//   info.shippingFee: orders.shipping_fee 권위값. 생략 시 총액-품목합으로 추정(구버전 호환).
export function computeCashReceiptAmounts(
  items: ReceiptItem[],
  total: number,
  info?: ReceiptOrderInfo
): CashReceiptAmounts {
  const weeks = Math.max(1, Math.round(info?.weeks ?? 1));
  let taxFreeGoods = 0;
  let taxableGoods = 0;
  for (const it of items) {
    const line = Math.max(0, Math.round(it.unitPrice * it.qty)) * weeks;
    if (isTaxFreeProduct(it.productId)) taxFreeGoods += line;
    else taxableGoods += line;
  }
  const goods = taxFreeGoods + taxableGoods;
  // 배송비: 권위값(orders.shipping_fee)이 있으면 그대로, 없으면 총액-품목합으로 추정.
  const shipping = Math.max(0, Math.round(info?.shippingFee ?? total - goods));

  // 배송비 귀속: 과세 품목이 없으면(전부 면세) 면세 부수용역, 아니면 과세 용역.
  const shippingTaxFree = taxableGoods === 0;
  let taxFreeAmount = taxFreeGoods + (shippingTaxFree ? shipping : 0);
  let taxableInclusive = taxableGoods + (shippingTaxFree ? 0 : shipping);

  // 불변식 보정: 세 항목 합이 실결제액(total)과 정확히 같아지도록 차액을 조정한다.
  //   total < 품목+배송(적립금 등 차감) → 차감액을 면세/과세에 비례 배분.
  //   total > 품목+배송(정보 부족·구버전) → 잔여를 배송비와 같은 쪽에 귀속.
  const gross = taxFreeAmount + taxableInclusive;
  const diff = total - gross;
  if (diff > 0) {
    if (shippingTaxFree) taxFreeAmount += diff;
    else taxableInclusive += diff;
  } else if (diff < 0) {
    const cut = -diff;
    let cutTaxable =
      gross > 0 ? Math.round((cut * taxableInclusive) / gross) : 0;
    if (cutTaxable > taxableInclusive) cutTaxable = taxableInclusive;
    let cutFree = cut - cutTaxable;
    if (cutFree > taxFreeAmount) {
      // cut ≤ gross 이므로 초과분은 반드시 과세쪽에서 흡수 가능하다.
      cutTaxable += cutFree - taxFreeAmount;
      cutFree = taxFreeAmount;
    }
    taxFreeAmount -= cutFree;
    taxableInclusive -= cutTaxable;
  }

  // 부가세 포함가 → 공급가액/부가세 분리. 합이 total 과 정확히 맞도록 부가세는 나머지로 둔다.
  const supplyAmount = Math.round(taxableInclusive / 1.1);
  const vat = taxableInclusive - supplyAmount;
  return { total, taxFreeAmount, supplyAmount, vat };
}
