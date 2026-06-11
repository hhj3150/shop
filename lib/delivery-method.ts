// 수령방법: 택배(기본) | 방문수령. 방문수령은 배송비 0(목장 직접 수령).
import { onceShippingFee, subShippingFee } from "./products";

export const DELIVERY_METHODS = ["택배", "방문수령"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export const DEFAULT_DELIVERY_METHOD: DeliveryMethod = "택배";

export function isPickup(method: DeliveryMethod): boolean {
  return method === "방문수령";
}

// 경계 검증: 외부(폼·쿼리·RPC 페이로드) 입력은 신뢰하지 않는다. 모르면 택배.
export function parseDeliveryMethod(value: unknown): DeliveryMethod {
  return value === "방문수령" ? "방문수령" : "택배";
}

// 단품 배송비: 방문수령이면 0, 아니면 지역별 택배비.
export function onceShippingFor(
  method: DeliveryMethod,
  subtotal: number,
  postcode?: string | null
): number {
  return isPickup(method) ? 0 : onceShippingFee(subtotal, postcode);
}

// 구독 배송비(기간 전체): 방문수령이면 0, 아니면 회당 택배비 × 주수.
export function subShippingFor(
  method: DeliveryMethod,
  perDeliveryListTotal: number,
  postcode: string | null | undefined,
  weeks: number
): number {
  return isPickup(method) ? 0 : subShippingFee(perDeliveryListTotal, postcode) * weeks;
}
