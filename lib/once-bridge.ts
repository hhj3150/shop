// 1회 구매 완료 화면의 '정기구독 안내'를 방금 산 제품으로 구체화한다.
//   개편 전 14일 퍼널에서 결제 시작 27건 중 16건이 1회 구매였는데, 완료 화면의 안내는
//   "최대 20% 더 저렴"이라는 일반 문구와 홈 링크뿐이었다. 산 제품의 병당 구독가와
//   그 제품 상세(정기구독 탭이 기본)로 바로 잇는다.
//   주문 생성·금액 계산과는 무관하다 — 완료 화면에 넘기는 표시용 값이다.
import {
  getPublicProduct,
  PERIOD_DISCOUNT,
  SUB_PERIODS,
  subscribePrice,
} from "@/lib/products";

export type OnceBridge = {
  name: string;
  href: string;
  listPrice: number; // 정가(1회 구매가)
  fromPrice: number; // 가장 긴 기간 기준 병당 구독가
  maxPct: number;
};

// 여러 제품을 샀으면 가장 많이 담은 제품(같으면 먼저 담긴 것)을 대표로 삼는다.
export function pickBridgeItem(items: { productId: string; qty: number }[]): string | null {
  let best: { productId: string; qty: number } | null = null;
  for (const it of items) {
    if (it.qty > 0 && (!best || it.qty > best.qty)) best = it;
  }
  return best ? best.productId : null;
}

// 쿼리로 넘어온 id 는 믿지 않는다 — 공개 제품이 아니면 null(일반 문구로 되돌아간다).
export function onceBridge(productId: string | null | undefined): OnceBridge | null {
  if (!productId) return null;
  const p = getPublicProduct(productId);
  if (!p) return null;
  const maxRate = Math.max(...SUB_PERIODS.map((m) => PERIOD_DISCOUNT[m]));
  return {
    name: `${p.name} ${p.volume}`, // 우유·요거트 모두 용량이 둘이라 이름만으로는 구분되지 않는다
    href: `/products/${p.id}`,
    listPrice: p.price,
    fromPrice: subscribePrice(p.price, maxRate),
    maxPct: Math.round(maxRate * 100),
  };
}
