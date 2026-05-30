export type ProductLine = "milk" | "yogurt";

export type ProductSpec = {
  label: string;
  value: string;
};

// 식품 표시기준에 따른 법정 제품표시사항.
export type ProductLabel = {
  type: string; // 식품유형
  ingredients: string; // 원재료명
  content: string; // 내용량 (및 열량)
  storage: string; // 보관방법
  packaging: string; // 포장재질
  maker: string; // 영업소 명칭 및 소재지
  shelf: string; // 소비기한
};

export type Product = {
  id: string;
  name: string;
  nameEn: string;
  line: ProductLine;
  volume: string;
  badge: string;
  kcal: number;
  tagline: string;
  taglineEm: string;
  shortDesc: string;
  story: string[];
  specs: ProductSpec[];
  label: ProductLabel;
  price: number;
  taxFree: boolean;
  image: string;
  accent: string;
};

// ───────── 정기구독 정책 ─────────
// 매주 1회 배송(신선도 유지), 요일은 월–금 중 하나 선택.
// 구독 기간(1/3/6/12개월)을 선택하고 그 기간 전체분을 한 번에 무통장입금.
// 1개월 = 4주(= 4회 배송). 기간이 길수록 할인율이 커진다.
export const WEEKS_PER_MONTH = 4;
export const MIN_ORDER_KRW = 20000; // 1회(매주) 배송 최소 상품 금액
export const SUB_SHIPPING_KRW = 4000; // 회당(매주) 배송비

// 구독 기간(개월).
export type SubPeriod = 1 | 3 | 6 | 12;
export const SUB_PERIODS: SubPeriod[] = [1, 3, 6, 12];
export const PERIOD_LABEL: Record<SubPeriod, string> = {
  1: "1개월",
  3: "3개월",
  6: "6개월",
  12: "12개월",
};

// 기간(개월) → 총 배송 회수(= 주분). 1개월 = 4주.
export function periodWeeks(months: SubPeriod): number {
  return months * WEEKS_PER_MONTH;
}

// 기간(개월) → 할인율. 1개월 10%, 3개월 15%, 6개월 20%, 12개월 25%.
export const PERIOD_DISCOUNT: Record<SubPeriod, number> = {
  1: 0.1,
  3: 0.15,
  6: 0.2,
  12: 0.25,
};
export function discountForPeriod(months: SubPeriod): number {
  return PERIOD_DISCOUNT[months];
}

// ───────── 단품(1회) 구매 정책 ─────────
// 정기구독과 별개. 상품 합계 25,000원 이상부터 결제 가능, 배송비 4,000원.
// 상품 합계 50,000원 이상이면 무료배송. 무통장입금 확인 후 발송(신청 다음 날, 월–금).
export const ONCE_MIN_KRW = 25000; // 단품 최소 상품 합계
export const ONCE_SHIPPING_KRW = 4000; // 단품 기본 배송비
export const ONCE_FREE_SHIP_KRW = 50000; // 이 금액 이상이면 무료배송

// 단품 상품 합계에 대한 배송비 계산.
export function onceShippingFee(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= ONCE_FREE_SHIP_KRW ? 0 : ONCE_SHIPPING_KRW;
}

// 정기구독 정원: 요일별 100명, 월–금 5일 = 전체 500명. 초과 시 대기자.
export const SUB_DAY_CAP = 100;
export const SUB_TOTAL_CAP = 500;

// 회원 기본 할인(1개월 기준 10%). 가격 표기/병당 회원가 계산의 기본값.
export const BASE_DISCOUNT = PERIOD_DISCOUNT[1];

export const PRODUCTS: Product[] = [
  {
    id: "milk-180",
    name: "A2 저지 헤이밀크",
    nameEn: "Hay Milk",
    line: "milk",
    volume: "180mL",
    badge: "Daily",
    kcal: 137,
    tagline: "한 손에 담기는",
    taglineEm: "하루의 시작.",
    shortDesc: "물처럼 가벼운 목넘김에 저지의 깊이를 담았습니다. 하루를 여는 가장 정직한 한 병.",
    story: [
      "대한민국 0.01%뿐인 A2/A2 저지소의 원유. 사일리지(발효사료) 없이 오직 신선한 풀과 건초만 먹여 길렀습니다.",
      "유럽이 수백 년 이어온 헤이밀크의 방식을, 안성의 목장에서 그대로 따릅니다.",
    ],
    specs: [
      { label: "원유", value: "A2/A2 저지 원유 100%" },
      { label: "사육", value: "Hay-fed · 무사일리지" },
      { label: "열량", value: "137 kcal" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "면세품" },
    ],
    label: {
      type: "우유류 (살균유)",
      ingredients: "원유(A2/A2 저지 원유 100%, 국산)",
      content: "180mL (137 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "유리병 / 종이팩",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관, 가능한 빨리 드십시오)",
    },
    price: 3500,
    taxFree: true,
    image: "/products/milk-180-pure.webp",
    accent: "#b89554",
  },
  {
    id: "milk-750",
    name: "A2 저지 헤이밀크",
    nameEn: "Hay Milk",
    line: "milk",
    volume: "750mL",
    badge: "Family",
    kcal: 570,
    tagline: "한 주를 채우는",
    taglineEm: "식탁의 풍요.",
    shortDesc: "같은 원유, 더 넉넉한 단위. 아침 한 잔부터 저녁 라떼까지 한 병이 일주일을 함께합니다.",
    story: [
      "대한민국 0.01%뿐인 A2/A2 저지소의 원유. 사일리지 없이 신선한 풀과 건초만 먹여 길렀습니다.",
      "냉장고 문을 열 때마다 목장의 아침을 떠올리게 하는, 유리병에 담긴 750mL.",
    ],
    specs: [
      { label: "원유", value: "A2/A2 저지 원유 100%" },
      { label: "사육", value: "Hay-fed · 무사일리지" },
      { label: "열량", value: "570 kcal / 병" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "면세품" },
    ],
    label: {
      type: "우유류 (살균유)",
      ingredients: "원유(A2/A2 저지 원유 100%, 국산)",
      content: "750mL (570 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "유리병 / 종이팩",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관, 가능한 빨리 드십시오)",
    },
    price: 12000,
    taxFree: true,
    image: "/products/milk-750-pure.webp",
    accent: "#a36b2c",
  },
  {
    id: "yogurt-180",
    name: "A2 저지 플레인 요거트",
    nameEn: "Plain Yogurt",
    line: "yogurt",
    volume: "180mL",
    badge: "Single",
    kcal: 140,
    tagline: "단정한 한 컵의",
    taglineEm: "발효.",
    shortDesc: "설탕도 향료도 없이, 우유와 유산균 두 가지로만. 하루 한 컵, 가장 단정한 발효.",
    story: [
      "A2 저지 원유를 그대로 발효했습니다. 첨가물 없이, 진한 우유 그 자체의 산미와 텍스처.",
      "사일리지 없는 헤이밀크 원유는 요거트로 발효했을 때 그 깊이가 더 선명하게 드러납니다.",
    ],
    specs: [
      { label: "원료", value: "A2 저지 원유 · 유산균" },
      { label: "첨가물", value: "무가당 · 무향료 · 무첨가" },
      { label: "열량", value: "약 140 kcal" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "과세품 · 세금 포함가" },
    ],
    label: {
      type: "발효유 (호상)",
      ingredients: "원유(A2 저지 원유, 국산), 유산균",
      content: "180mL (약 140 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "용기·뚜껑(PP/PS 등)",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관)",
    },
    price: 4300,
    taxFree: false,
    image: "/products/yogurt-180-pure.webp",
    accent: "#7a8a3d",
  },
  {
    id: "yogurt-500",
    name: "A2 저지 플레인 요거트",
    nameEn: "Plain Yogurt",
    line: "yogurt",
    volume: "500mL",
    badge: "Plain",
    kcal: 390,
    tagline: "발효, 그 한 가지의",
    taglineEm: "깊이.",
    shortDesc: "설탕도 향료도 첨가물도 없이. 우유와 유산균 두 가지만으로 완성한 진짜 플레인.",
    story: [
      "온 가족이 나누는 500mL. 떠먹을수록 진해지는 텍스처는 좋은 원유에서만 나옵니다.",
      "무엇을 더해도 흔들리지 않는 베이스. 사일리지 없는 헤이밀크 원유의 단단함입니다.",
    ],
    specs: [
      { label: "원료", value: "A2 저지 원유 · 유산균" },
      { label: "첨가물", value: "무가당 · 무향료 · 무첨가" },
      { label: "열량", value: "390 kcal / 통" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "과세품 · 세금 포함가" },
    ],
    label: {
      type: "발효유 (호상)",
      ingredients: "원유(A2 저지 원유, 국산), 유산균",
      content: "500mL (약 390 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "용기·뚜껑(PP/PS 등)",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관)",
    },
    price: 10000,
    taxFree: false,
    image: "/products/yogurt-500-pure.webp",
    accent: "#6f7d36",
  },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

// 할인율을 적용한 1회(병당) 구독가. 10원 단위 반올림.
export function subscribePrice(price: number, rate: number = BASE_DISCOUNT): number {
  return Math.round((price * (1 - rate)) / 10) * 10;
}

export function formatKRW(value: number): string {
  return "₩" + value.toLocaleString("ko-KR");
}
