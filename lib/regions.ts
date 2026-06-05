// 특수배송지역(제주·도서산간 등) 판별.
//   당일/익일 신선 배송이 어려운 지역은 배송비를 5,000원으로 하고,
//   주문 화면에서 "신선함이 생명" 경고 + 동의를 받는다.
//
// ⚠ 동기화(중요): 이 목록은 supabase/migration-special-delivery-region.sql 의
//   public.is_special_delivery_postcode() 와 반드시 동일하게 유지해야 한다.
//   실제 청구 배송비는 서버 RPC가 계산하므로, 둘이 어긋나면 화면 표시액과
//   실제 결제액이 달라진다. 한쪽을 고치면 반드시 다른 쪽도 함께 고칠 것.

// 특수배송지역 배송비(회당/1회). 일반 지역은 products.ts 의 4,000원.
export const SPECIAL_DELIVERY_SHIPPING_KRW = 5000;

// 우편번호 구간(신우편번호 5자리, 양끝 포함).
type PostcodeRange = readonly [number, number];

// 구간으로 묶이는 대표 특수배송지역.
const SPECIAL_RANGES: readonly PostcodeRange[] = [
  [63000, 63644], // 제주특별자치도 전역
  [40200, 40240], // 경상북도 울릉군(울릉도·독도)
];

// 위 구간으로 못 잡는 개별 도서 우편번호(편집 가능).
//   택배사에서 받은 도서산간 우편번호 목록을 여기에 추가하면 그대로 반영된다.
//   추가/수정 시 위 동기화 주석에 따라 SQL 마이그레이션도 함께 갱신할 것.
const EXTRA_SPECIAL_POSTCODES: ReadonlySet<string> = new Set<string>([
  // 예) 인천 옹진군·전남 신안군 등 개별 도서 우편번호를 5자리 그대로 추가
]);

// 우편번호 문자열에서 숫자 5자리만 추출. 형식이 아니면 null.
function normalizePostcode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const digits = postcode.replace(/[^0-9]/g, "");
  return digits.length === 5 ? digits : null;
}

// 특수배송지역(제주·도서산간 등) 여부. 우편번호 5자리 기준.
//   판별 불가(빈 값·형식 오류)면 false → 일반 지역으로 처리(과청구 방지).
export function isSpecialDeliveryPostcode(
  postcode: string | null | undefined
): boolean {
  const code = normalizePostcode(postcode);
  if (code === null) return false;
  if (EXTRA_SPECIAL_POSTCODES.has(code)) return true;
  const n = Number(code);
  return SPECIAL_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}
