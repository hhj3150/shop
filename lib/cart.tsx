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
  type SubPeriod,
} from "./products";

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

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [period, setPeriodState] = useState<SubPeriod>(1);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: StoredCart = JSON.parse(raw);
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (parsed.period) setPeriodState(parsed.period);
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

  const value = useMemo<CartContextValue>(() => {
    const rate = discountForPeriod(period);
    const weeklyPrice = (productId: string) => {
      const p = getProduct(productId);
      return p ? subscribePrice(p.price, rate) : 0;
    };
    const count = items.reduce((n, i) => n + i.qty, 0);
    const perDelivery = items.reduce(
      (n, i) => n + i.qty * weeklyPrice(i.productId),
      0
    );
    const weeks = periodWeeks(period);
    const shipPerDelivery = subShippingFee(perDelivery);

    return {
      items,
      isOpen,
      count,
      period,
      weeks,
      perDelivery,
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
      },
      setQty: (key, qty) =>
        setItems((prev) =>
          prev
            .map((i) => (i.key === key ? { ...i, qty: Math.max(0, qty) } : i))
            .filter((i) => i.qty > 0)
        ),
      remove: (key) => setItems((prev) => prev.filter((i) => i.key !== key)),
      clear: () => setItems([]),
    };
  }, [items, period, isOpen]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
