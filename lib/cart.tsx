"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getProduct,
  subscribePrice,
  discountForPeriod,
  periodWeeks,
  subShippingFee,
  SUB_PERIODS,
  type SubPeriod,
} from "./products";
import { useStorefrontCatalog } from "./storefront";
import { mergeProduct } from "./storefront-merge";

// 매주 1회 배송, 요일은 월–금 중 하나 선택.
export type DeliveryDay = "mon" | "tue" | "wed" | "thu" | "fri";

export const DELIVERY_DAY_LABEL: Record<DeliveryDay, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
};

export const DELIVERY_DAYS: DeliveryDay[] = ["mon", "tue", "wed", "thu", "fri"];

// 장바구니에 담긴 서로 다른 배송 요일(정렬은 월→금 고정). 한 정기구독 주문은 한 요일만
//   허용한다(요일별로 회차 금액·배송비·배송 명단이 따로 잡혀야 하므로) — 길이>1 이면 다요일.
//   서버(create_subscription_order)도 같은 규칙으로 막으며, 여기선 결제 전 능동 안내에 쓴다.
export function cartDeliveryDays(
  items: ReadonlyArray<Pick<CartItem, "deliveryDay">>
): DeliveryDay[] {
  return DELIVERY_DAYS.filter((d) => items.some((i) => i.deliveryDay === d));
}

// 장바구니 요일 중 이미 내 구독 슬롯(비해지)이 점유한 요일(월→금 정렬). 한 회원은 요일별
//   슬롯 하나만 가질 수 있으므로(unique index subscription_slots_user_day_uniq), 겹치는
//   요일에는 신규 구독을 만들 수 없다 — 활성 구독이면 연장(request_renewal)으로 접수하고,
//   신청(입금 전)·대기면 상태 안내 대상. 서버(create_subscription_order)도 같은 규칙으로 막는다.
export function conflictingDeliveryDays(
  cartDays: ReadonlyArray<DeliveryDay>,
  occupiedDays: ReadonlyArray<DeliveryDay>
): DeliveryDay[] {
  return DELIVERY_DAYS.filter(
    (d) => cartDays.includes(d) && occupiedDays.includes(d)
  );
}

// 내 구독 슬롯(비해지) 요약 — 체크아웃의 같은 요일 충돌 판정·연장 전환용.
export type SubscriptionSlotLite = {
  id: number;
  delivery_day: DeliveryDay;
  status: string; // 신청 | 활성 | 대기 ('해지'는 조회에서 제외)
};

// 장바구니가 단일 요일일 때 그 요일을 점유한 내 슬롯(없으면 null).
//   활성 슬롯이면 체크아웃이 신규 주문 대신 연장(재입금)으로 접수한다 — 같은 요일 유지·
//   구성품 변경·만료 전(미리) 신청 모두 request_renewal 이 지원한다.
//   신청(입금 전)·대기 슬롯이면 연장 불가 → 상태 안내 후 제출 차단.
//   (다요일 장바구니는 multiDay 차단이 선행되므로 여기선 null.)
export function slotOnCartDay(
  cartDays: ReadonlyArray<DeliveryDay>,
  slots: ReadonlyArray<SubscriptionSlotLite>
): SubscriptionSlotLite | null {
  if (cartDays.length !== 1) return null;
  return slots.find((s) => s.delivery_day === cartDays[0]) ?? null;
}

export type CartItem = {
  key: string;
  productId: string;
  deliveryDay: DeliveryDay;
  qty: number; // 매주 회당 수량
};

type CartContextValue = {
  items: CartItem[];
  isOpen: boolean;
  count: number;
  period: SubPeriod; // 구독 기간(개월) — 장바구니 전체에 하나
  weeks: number; // 기간 → 총 배송 회수(= 주분)
  perDelivery: number; // 1회(매주) 상품 합계 (기간 할인 적용)
  perDeliveryList: number; // 1회(매주) 상품 합계 (정가) — 최소주문금액 판정 기준
  shipPerDelivery: number; // 1회(매주) 배송비
  shipTotal: number; // 전체 기간분 배송비
  periodTotal: number; // 전체 기간분 = 한 번에 입금할 금액 (상품 + 배송비)
  weeklyPrice: (productId: string) => number; // 제품별 1회(병당) 회원가
  open: () => void;
  close: () => void;
  setPeriod: (months: SubPeriod) => void;
  add: (item: Omit<CartItem, "key">) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  lastAdded: { key: string; seq: number } | null; // 방금 담은 항목 — 드로어 하이라이트 신호
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "sys-cart-v3";

type StoredCart = {
  items: CartItem[];
  period: SubPeriod;
};

function itemKey(i: Omit<CartItem, "key">): string {
  return `${i.productId}:${i.deliveryDay}`;
}

// localStorage 복원값 검증 — 손상·구버전 데이터가 존재하지 않는 기간(할인율 undefined)이나
//   음수/문자열 수량으로 가격 계산을 조용히 망가뜨리지 않게 여기서 걸러낸다.
function sanitizeStoredItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (i): i is CartItem =>
        !!i &&
        typeof i === "object" &&
        typeof (i as CartItem).productId === "string" &&
        DELIVERY_DAYS.includes((i as CartItem).deliveryDay) &&
        Number.isInteger((i as CartItem).qty) &&
        (i as CartItem).qty > 0
    )
    .map((i) => ({ ...i, key: itemKey(i) }));
}

function sanitizeStoredPeriod(raw: unknown): SubPeriod | null {
  return SUB_PERIODS.includes(raw as SubPeriod) ? (raw as SubPeriod) : null;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [period, setPeriodState] = useState<SubPeriod>(2); // 8주 기본('인기')
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // 방금 담은 항목 키 + 증가 시퀀스(같은 항목을 또 담아도 신호가 갱신되도록).
  const [lastAdded, setLastAdded] = useState<{ key: string; seq: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: StoredCart = JSON.parse(raw);
        const items = sanitizeStoredItems(parsed.items);
        if (items.length > 0) setItems(items);
        const period = sanitizeStoredPeriod(parsed.period);
        if (period) setPeriodState(period);
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload: StoredCart = { items, period };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota / private mode
    }
  }, [items, period, hydrated]);

  // 가격 권위는 product_catalog(DB)다. 정적 price는 카탈로그 로드 전 폴백일 뿐.
  const { map } = useStorefrontCatalog();

  const value = useMemo<CartContextValue>(() => {
    const rate = discountForPeriod(period);
    const weeklyPrice = (productId: string) => {
      const p = getProduct(productId);
      return p ? subscribePrice(mergeProduct(p, map.get(productId)).price, rate) : 0;
    };
    const listPrice = (productId: string) => {
      const p = getProduct(productId);
      return p ? mergeProduct(p, map.get(productId)).price : 0;
    };
    const count = items.reduce((n, i) => n + i.qty, 0);
    const perDelivery = items.reduce(
      (n, i) => n + i.qty * weeklyPrice(i.productId),
      0
    );
    // 정가 회당 합계 — 최소주문금액(MIN_ORDER_KRW)은 단품과 동일하게 정가 기준으로 판정한다.
    //   (할인가 기준이면 750mL 2병=정가 24,000원이 할인 후 21,600원이 되어 부당하게 차단됨)
    const perDeliveryList = items.reduce(
      (n, i) => n + i.qty * listPrice(i.productId),
      0
    );
    const weeks = periodWeeks(period);
    const shipPerDelivery = subShippingFee(perDeliveryList);

    return {
      items,
      isOpen,
      count,
      period,
      weeks,
      perDelivery,
      perDeliveryList,
      shipPerDelivery,
      shipTotal: shipPerDelivery * weeks,
      periodTotal: (perDelivery + shipPerDelivery) * weeks,
      weeklyPrice,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      setPeriod: (months) => setPeriodState(months),
      add: (incoming) => {
        const key = itemKey(incoming);
        setItems((prev) => {
          const existing = prev.find((i) => i.key === key);
          if (existing) {
            return prev.map((i) =>
              i.key === key ? { ...i, qty: i.qty + incoming.qty } : i
            );
          }
          return [...prev, { ...incoming, key }];
        });
        setIsOpen(true);
        setLastAdded((prev) => ({ key, seq: (prev?.seq ?? 0) + 1 }));
      },
      setQty: (key, qty) =>
        setItems((prev) =>
          prev
            .map((i) => (i.key === key ? { ...i, qty: Math.max(0, qty) } : i))
            .filter((i) => i.qty > 0)
        ),
      remove: (key) => setItems((prev) => prev.filter((i) => i.key !== key)),
      clear: () => setItems([]),
      lastAdded,
    };
  }, [items, period, isOpen, map, lastAdded]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
