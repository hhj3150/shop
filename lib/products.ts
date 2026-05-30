export type ProductLine = "milk" | "yogurt";

export type ProductSpec = {
  label: string;
  value: string;
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
  price: number;
  taxFree: boolean;
  image: string;
  detailImage: string;
  accent: string;
};

export const SUBSCRIBE_DISCOUNT = 0.1;

// 정기구독은 주 1회, 한 번 신청하면 최소 8회를 받습니다.
export const SUB_MIN_DELIVERIES = 8;

export const PRODUCTS: Product[] = [
  {
    id: "milk-180",
    name: "A2 저지 헤이밀크",
    nameEn: "Hay Milk",
    line: "milk",
    volume: "180mL",
    badge: "Daily",
    kcal: 137,
    tagline: "한 손에 잡히는",
    taglineEm: "한 끼.",
    shortDesc: "물보다 가벼운 목넘김, 저지의 깊이. 가장 작은 단위가 가장 정직한 단위가 되는 한 병.",
    story: [
      "국내 1.6%뿐인 A2/A2 저지소의 원유. 사일리지 없이 오직 건초만 먹은 헤이밀크입니다.",
      "180mL은 하루의 시작에 놓이는 단위입니다. 한 손에 들어오는 한 병이, 한 끼의 정직함이 됩니다.",
    ],
    specs: [
      { label: "원유", value: "A2/A2 저지 원유 100%" },
      { label: "사육", value: "Hay-fed · 무사일리지" },
      { label: "열량", value: "137 kcal" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "면세품" },
    ],
    price: 3500,
    taxFree: true,
    image: "/products/milk-180.png",
    detailImage: "/detail/milk-180.jpg",
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
    tagline: "식탁 위의",
    taglineEm: "풍요.",
    shortDesc: "한 병이 식탁을 채우는 단위. 가족이 둘러앉아 한 주를 함께 보내기에 가장 송영신스러운 750mL.",
    story: [
      "같은 원유, 더 넉넉한 단위. 아침 시리얼부터 저녁 라떼까지 한 병이 일주일을 채웁니다.",
      "유리병에 담긴 750mL은 냉장고 문을 열 때마다 목장을 떠올리게 합니다.",
    ],
    specs: [
      { label: "원유", value: "A2/A2 저지 원유 100%" },
      { label: "사육", value: "Hay-fed · 무사일리지" },
      { label: "열량", value: "570 kcal / 병" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "면세품" },
    ],
    price: 12000,
    taxFree: true,
    image: "/products/milk-750.png",
    detailImage: "/detail/milk-750.jpg",
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
    tagline: "한 컵의",
    taglineEm: "발효.",
    shortDesc: "설탕도 향료도 없이, 우유와 유산균 두 가지로만. 하루 한 컵의 가장 단정한 발효.",
    story: [
      "A2 저지 원유를 그대로 발효했습니다. 첨가물 없이, 진한 우유 그 자체의 산미와 텍스처.",
      "180mL 한 컵은 아침 또는 한낮의 단정한 마침표. 그래놀라와도, 그대로도 좋습니다.",
    ],
    specs: [
      { label: "원료", value: "A2 저지 원유 · 유산균" },
      { label: "첨가물", value: "무가당 · 무향료 · 무첨가" },
      { label: "열량", value: "약 140 kcal" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "과세품 · 세금 포함가" },
    ],
    price: 4300,
    taxFree: false,
    image: "/products/yogurt-180.png",
    detailImage: "/detail/yogurt-180.jpg",
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
    shortDesc: "설탕도, 향료도, 첨가물도 없이. 우유와 유산균 — 두 가지만으로 완성되는 '진짜 플레인'.",
    story: [
      "온 가족이 나누는 500mL. 떠먹을수록 진해지는 텍스처는 좋은 원유에서만 나옵니다.",
      "과일, 꿀, 그래놀라를 더하면 나만의 한 그릇. 무엇을 더해도 베이스가 흔들리지 않습니다.",
    ],
    specs: [
      { label: "원료", value: "A2 저지 원유 · 유산균" },
      { label: "첨가물", value: "무가당 · 무향료 · 무첨가" },
      { label: "열량", value: "390 kcal / 통" },
      { label: "보관", value: "냉장 0–10℃" },
      { label: "구분", value: "과세품 · 세금 포함가" },
    ],
    price: 10000,
    taxFree: false,
    image: "/products/yogurt-500.png",
    detailImage: "/detail/yogurt-500.jpg",
    accent: "#6f7d36",
  },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function subscribePrice(price: number): number {
  return Math.round((price * (1 - SUBSCRIBE_DISCOUNT)) / 10) * 10;
}

export function formatKRW(value: number): string {
  return "₩" + value.toLocaleString("ko-KR");
}
