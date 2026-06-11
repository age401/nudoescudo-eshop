"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type CartItem = {
  stockId: string;
  cardName: string;
  setName: string;
  finish: string;
  condition: string;
  language: string;
  unitPriceUsd: number;
  imageUrl: string | null;
  /** Availability known at add time; re-validated server-side at checkout. */
  available: number;
  quantity: number;
  href: string;
};

type CartApi = {
  items: CartItem[];
  count: number;
  totalUsd: number;
  add: (item: Omit<CartItem, "quantity">, quantity: number) => void;
  setQuantity: (stockId: string, quantity: number) => void;
  remove: (stockId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartApi | null>(null);
const STORAGE_KEY = "ne_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage once on mount. The microtask keeps the state
  // updates out of the synchronous effect body (react-hooks lint).
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setItems(JSON.parse(raw));
      } catch {
        // corrupted cart: start fresh
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, hydrated]);

  const add = useCallback((item: Omit<CartItem, "quantity">, quantity: number) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.stockId === item.stockId);
      if (existing) {
        const q = Math.min(existing.quantity + quantity, item.available);
        return prev.map((i) =>
          i.stockId === item.stockId ? { ...i, ...item, quantity: q } : i,
        );
      }
      return [...prev, { ...item, quantity: Math.min(quantity, item.available) }];
    });
  }, []);

  const setQuantity = useCallback((stockId: string, quantity: number) => {
    setItems((prev) =>
      prev
        .map((i) => (i.stockId === stockId ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const remove = useCallback((stockId: string) => {
    setItems((prev) => prev.filter((i) => i.stockId !== stockId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const api = useMemo<CartApi>(() => {
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const totalUsd = items.reduce((n, i) => n + i.quantity * i.unitPriceUsd, 0);
    return { items, count, totalUsd, add, setQuantity, remove, clear };
  }, [items, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
