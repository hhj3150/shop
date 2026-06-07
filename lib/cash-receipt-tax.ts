// 현금영수증 과세/면세 분리 계산.
//   정책(사업자 확인): 우유(헤이밀크)=면세, 요거트=과세. 판매가는 모두 '부가세 포함가'.
//   현금영수증은 면세금액과 과세분(공급가액+부가세)을 나눠 적어야 하므로, 주문 한 건을
//   품목별 면세/과세로 가른 뒤 과세분에서 부가세를 역산한다(포함가 ÷ 1.1).
//   배송비는 주문 총액에서 품목합을 뺀 값으로 보고, '과세 품목이 하나도 없으면(전부 면세)'
//   부수용역으로 면세 처리, 그 외에는 과세 용역으로 처리한다. (세무 판단은 사업자 확인 권장)
import { PRODUCTS } from "./products";

export type ReceiptItem = {
  productId: string;
  unitPrice: number; // 부가세 포함 단가
  qty: number;
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
export function computeCashReceiptAmounts(
  items: ReceiptItem[],
  total: number
): CashReceiptAmounts {
  let taxFreeGoods = 0;
  let taxableGoods = 0;
  for (const it of items) {
    const line = Math.max(0, Math.round(it.unitPrice * it.qty));
    if (isTaxFreeProduct(it.productId)) taxFreeGoods += line;
    else taxableGoods += line;
  }
  const goods = taxFreeGoods + taxableGoods;
  const shipping = Math.max(0, total - goods); // 배송비 = 총액 - 품목합

  // 배송비 귀속: 과세 품목이 없으면(전부 면세) 면세 부수용역, 아니면 과세 용역.
  const shippingTaxFree = taxableGoods === 0;
  const taxFreeAmount = taxFreeGoods + (shippingTaxFree ? shipping : 0);
  const taxableInclusive = taxableGoods + (shippingTaxFree ? 0 : shipping);

  // 부가세 포함가 → 공급가액/부가세 분리. 합이 total 과 정확히 맞도록 부가세는 나머지로 둔다.
  const supplyAmount = Math.round(taxableInclusive / 1.1);
  const vat = taxableInclusive - supplyAmount;
  return { total, taxFreeAmount, supplyAmount, vat };
}
