"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BLOCK_WEEKS } from "./products";

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
  unitPrice: number; // 할인 적용된 1회(병당) 가격
};

type CartContextValue = {
  items: CartItem[];
  isOpen: boolean;
  count: number;
  perDelivery: number; // 1회(매주) 합계
  blockTotal: number; // 4주분(=4회) 합계 = 실제 입금 금액
  open: () => void;
  close: () => void;
  add: (item: Omit<CartItem, "key">) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "sys-cart-v2";

function itemKey(i: Omit<CartItem, "key">): string {
  return `${i.productId}:${i.deliveryDay}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore quota / private mode
    }
  }, [items, hydrated]);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((n, i) => n + i.qty, 0);
    const perDelivery = items.reduce((n, i) => n + i.qty * i.unitPrice, 0);

    return {
      items,
      isOpen,
      count,
      perDelivery,
      blockTotal: perDelivery * BLOCK_WEEKS,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
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
  }, [items, isOpen]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
