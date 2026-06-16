import {
  SPECIAL_DELIVERY_SHIPPING_KRW,
  isSpecialDeliveryPostcode,
} from "./regions";

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

// 영양정보 한 줄. percent는 "% 영양성분기준치" 칸(미표시는 "-").
export type NutritionRow = {
  label: string; // 영양성분명 (나트륨, 탄수화물 …)
  amount: string; // 함량 (44 mg, 5.0 g …)
  percent: string; // % 영양성분기준치 ("2 %", "-")
};

// 영양정보표. basis는 표시 기준(100mL당 / 총 내용량 180mL당).
export type Nutrition = {
  basis: string; // 영양정보 표시 기준
  calories: string; // 총 열량
  rows: NutritionRow[];
};

// 히어로 요약 하이라이트 한 줄. v/em의 인라인 강조 규약:
//   *키워드* → 굵게(잉크),  ~숫자~ → 명조 강조.
export type ProductHighlightRow = {
  k: string; // 좌측 소형 라벨 (원유, 사육 …)
  v: string; // 본문 값
  em?: string; // 보조 설명(연한 회색, 출처·기준 등)
};

// 히어로 요약 블록. 효능 표현 없이 사실만(식품 표시·광고법 안전선).
export type ProductHighlights = {
  kicker: string; // 선언 2줄. 줄바꿈은 "\n", *0.01%* → 골드 강조.
  rows: ProductHighlightRow[];
  proof: string; // 출처 한 줄(공인 분석 접수번호 등)
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
  nutrition: Nutrition;
  highlights?: ProductHighlights;
  price: number;
  taxFree: boolean;
  image: string;
  accent: string;
};

// 히어로 요약 — 우유/요거트 라인별 공유(같은 원유·공정·분석성적서).
// 모든 줄은 검증된 사실 서술. 질병·기능성 암시 금지.
const MILK_HIGHLIGHTS: ProductHighlights = {
  kicker: "0.01%의 소로,\n*0.01%*를 위해.",
  rows: [
    { k: "살균", v: "*HTST 살균.* 최소한의 균질." },
    { k: "오메가", v: "6:3, ~2:1~의 균형.", em: "당사 분석 기준" },
    { k: "원산지", v: "*100% 국내산* A2 저지." },
  ],
  proof: "공인 영양성분 분석 · 26-06-BR0114",
};

const YOGURT_HIGHLIGHTS: ProductHighlights = {
  kicker: "0.01%의 우유로,\n*0.01%*를 위해.",
  rows: [
    { k: "유산균", v: "~1g당 7.2억~ CFU.", em: "공인 시험성적서" },
    { k: "당류", v: "*무설탕.* 남은 당은 우유 유당뿐.", em: "12시간 발효로 원유 5.9g → 3.5g (100g당)" },
    { k: "발효", v: "유산균과 ~12시간~. 그뿐입니다." },
  ],
  proof: "공인 영양성분 분석 · 26-06-BR0115 · 무증점제",
};

// ───────── 정기구독 정책 ─────────
// 매주 1회 배송(신선도 유지), 요일은 월–금 중 하나 선택.
// 구독 기간은 4·8·12주 중 선택. 1개월 = 4주(= 4회 배송)분을 한 번에 무통장입금(4회분 선납).
// 회원 할인율 10/12/15%. 다음 달도 받으시려면 매월 연장(재입금)한다.
export const WEEKS_PER_MONTH = 4;
export const MIN_ORDER_KRW = 24000; // 1회(매주) 배송 최소 상품 금액 (단품과 동일). 750mL 12,000원 × 2병.
export const SUB_SHIPPING_KRW = 4000; // 회당(매주) 배송비

// 정기구독 회당 배송비. 주문 금액과 무관하게 항상 자부담(무료배송 없음).
//   postcode가 특수배송지역(제주·도서산간 등)이면 회당 5,000원.
//   미지정(장바구니 등 주소 입력 전)이면 일반 4,000원으로 표시한다.
export function subShippingFee(
  perDeliveryListTotal: number,
  postcode?: string | null
): number {
  if (perDeliveryListTotal <= 0) return 0;
  return isSpecialDeliveryPostcode(postcode)
    ? SPECIAL_DELIVERY_SHIPPING_KRW
    : SUB_SHIPPING_KRW;
}

// 구독 기간(개월): 1=4주, 2=8주, 3=12주. 사용자에겐 '주'로 노출(PERIOD_LABEL).
export type SubPeriod = 1 | 2 | 3;
export const SUB_PERIODS: SubPeriod[] = [1, 2, 3];
export const PERIOD_LABEL: Record<SubPeriod, string> = {
  1: "4주",
  2: "8주",
  3: "12주",
};

// 기간(개월) → 총 배송 회수(= 주분). 1개월 = 4주(= 4회분 선납).
export function periodWeeks(months: SubPeriod): number {
  return months * WEEKS_PER_MONTH;
}

// 기간(개월) → 할인율. 4주 10% / 8주 12% / 12주 15%.
export const PERIOD_DISCOUNT: Record<SubPeriod, number> = {
  1: 0.10,
  2: 0.12,
  3: 0.15,
};
// 기간 배지(표시용). 8주=인기 기본, 12주=최대 할인. 4주는 배지 없음.
export const PERIOD_BADGE: Partial<Record<SubPeriod, string>> = {
  2: "인기",
  3: "최대 할인",
};
export function discountForPeriod(months: SubPeriod): number {
  return PERIOD_DISCOUNT[months];
}

// ───────── 단품(1회) 구매 정책 ─────────
// 정기구독과 별개. 상품 합계 24,000원 이상부터 결제 가능, 배송비 4,000원.
// 주문 금액과 무관하게 배송비는 항상 자부담(무료배송 없음). 무통장입금 확인 후 발송(신청 다음 날, 월–금).
export const ONCE_MIN_KRW = 24000; // 단품 최소 상품 합계 (750mL 12,000원 × 2병)
export const ONCE_SHIPPING_KRW = 4000; // 단품 기본 배송비

// 단품 상품 합계에 대한 배송비 계산. 금액과 무관하게 항상 자부담.
//   postcode가 특수배송지역(제주·도서산간 등)이면 5,000원.
export function onceShippingFee(
  subtotal: number,
  postcode?: string | null
): number {
  if (subtotal <= 0) return 0;
  return isSpecialDeliveryPostcode(postcode)
    ? SPECIAL_DELIVERY_SHIPPING_KRW
    : ONCE_SHIPPING_KRW;
}

// 정기구독 정원: 요일별 100명, 월–금 5일 = 전체 500명. 초과 시 대기자.
export const SUB_DAY_CAP = 100;
export const SUB_TOTAL_CAP = 500;

// 회원 기본 할인(4주 기준 10%). 상품카드 병당 회원가 표기의 기본값.
export const BASE_DISCOUNT = PERIOD_DISCOUNT[1];

export const PRODUCTS: Product[] = [
  {
    id: "milk-180",
    name: "A2 저지 헤이밀크",
    nameEn: "Hay Milk",
    line: "milk",
    volume: "180mL",
    badge: "Daily",
    kcal: 135,
    tagline: "한 손에 담기는",
    taglineEm: "하루의 시작.",
    shortDesc: "가볍게, 그러나 깊게. 하루를 여는 한 병.",
    story: [
      "대한민국 0.01%뿐인 A2/A2 저지소의 원유. 사일리지(발효사료) 없이 오직 신선한 풀과 건초만 먹여 길렀습니다.",
      "유럽이 수백 년 이어온 헤이밀크의 방식을, 안성의 목장에서 그대로 따릅니다.",
    ],
    specs: [
      { label: "원유", value: "A2/A2 저지 원유 100%" },
      { label: "사육", value: "Hay-fed · 무사일리지" },
      { label: "열량", value: "135 kcal" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "면세품" },
    ],
    label: {
      type: "우유류 (살균유)",
      ingredients: "원유(A2/A2 저지 원유 100%, 국산)",
      content: "180mL (135 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "PET병",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관, 가능한 빨리 드십시오)",
    },
    nutrition: {
      basis: "총 내용량 180mL당",
      calories: "135 kcal",
      rows: [
        { label: "나트륨", amount: "80 mg", percent: "4 %" },
        { label: "탄수화물", amount: "9.0 g", percent: "3 %" },
        { label: "당류", amount: "5.9 g", percent: "6 %" },
        { label: "지방", amount: "8.1 g", percent: "15 %" },
        { label: "트랜스지방", amount: "0 g", percent: "-" },
        { label: "포화지방", amount: "4.5 g", percent: "30 %" },
        { label: "콜레스테롤", amount: "25 mg", percent: "8 %" },
        { label: "단백질", amount: "6.8 g", percent: "12 %" },
      ],
    },
    highlights: MILK_HIGHLIGHTS,
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
    shortDesc: "같은 원유, 더 넉넉하게. 한 병이 일주일을 함께.",
    story: [
      "대한민국 0.01%뿐인 A2/A2 저지소의 원유. 사일리지 없이 신선한 풀과 건초만 먹여 길렀습니다.",
      "냉장고 문을 열 때마다 목장의 아침을 떠올리게 하는, 넉넉한 750mL 한 병.",
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
      packaging: "PET병",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관, 가능한 빨리 드십시오)",
    },
    nutrition: {
      basis: "100mL당",
      calories: "76 kcal",
      rows: [
        { label: "나트륨", amount: "44 mg", percent: "2 %" },
        { label: "탄수화물", amount: "5.0 g", percent: "2 %" },
        { label: "당류", amount: "3.3 g", percent: "3 %" },
        { label: "지방", amount: "4.5 g", percent: "8 %" },
        { label: "트랜스지방", amount: "0 g", percent: "-" },
        { label: "포화지방", amount: "2.5 g", percent: "17 %" },
        { label: "콜레스테롤", amount: "15 mg", percent: "5 %" },
        { label: "단백질", amount: "3.8 g", percent: "7 %" },
      ],
    },
    highlights: MILK_HIGHLIGHTS,
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
    shortDesc: "건강한 우유, 프리미엄 유산균, 12시간 발효. 그뿐입니다.",
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
      type: "발효유 (액상)",
      ingredients: "원유(A2 저지 원유, 국산), 유산균",
      content: "180mL (약 140 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "PET병",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관)",
    },
    nutrition: {
      basis: "총 내용량 180mL당",
      calories: "140 kcal",
      rows: [
        { label: "나트륨", amount: "95 mg", percent: "5 %" },
        { label: "탄수화물", amount: "8.1 g", percent: "3 %" },
        { label: "당류", amount: "3.4 g", percent: "3 %" },
        { label: "지방", amount: "8.8 g", percent: "16 %" },
        { label: "트랜스지방", amount: "0 g", percent: "-" },
        { label: "포화지방", amount: "8.6 g", percent: "57 %" },
        { label: "콜레스테롤", amount: "75 mg", percent: "25 %" },
        { label: "단백질", amount: "7.6 g", percent: "14 %" },
      ],
    },
    highlights: YOGURT_HIGHLIGHTS,
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
    shortDesc: "건강한 우유, 프리미엄 유산균, 12시간 발효. 가족이 넉넉히.",
    story: [
      "온 가족이 나누는 500mL. 한 모금마다 느껴지는 농밀함은 좋은 원유에서만 나옵니다.",
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
      type: "발효유 (액상)",
      ingredients: "원유(A2 저지 원유, 국산), 유산균",
      content: "500mL (약 390 kcal)",
      storage: "냉장 0–10℃ 보관",
      packaging: "PET병",
      maker: "농업회사법인 주식회사 디투오 · 경기도 안성시 미양면 미양로 466",
      shelf: "제품에 별도 표기 (냉장 보관)",
    },
    nutrition: {
      basis: "100mL당",
      calories: "78 kcal",
      rows: [
        { label: "나트륨", amount: "52 mg", percent: "3 %" },
        { label: "탄수화물", amount: "4.5 g", percent: "1 %" },
        { label: "당류", amount: "1.9 g", percent: "2 %" },
        { label: "지방", amount: "4.9 g", percent: "9 %" },
        { label: "트랜스지방", amount: "0 g", percent: "0 %" },
        { label: "포화지방", amount: "4.8 g", percent: "32 %" },
        { label: "콜레스테롤", amount: "42 mg", percent: "14 %" },
        { label: "단백질", amount: "4.2 g", percent: "8 %" },
      ],
    },
    highlights: YOGURT_HIGHLIGHTS,
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
