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
  /** `printingId|finish|language` — conditions are merged into one pool. */
  poolKey: string;
  printingId: string;
  cardName: string;
  setName: string;
  finish: string;
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
  setQuantity: (poolKey: string, quantity: number) => void;
  remove: (poolKey: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartApi | null>(null);
// v2: items are keyed by pool, not by stock row. Older carts are dropped.
const STORAGE_KEY = "ne_cart_v2";

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
      const existing = prev.find((i) => i.poolKey === item.poolKey);
      if (existing) {
        const q = Math.min(existing.quantity + quantity, item.available);
        return prev.map((i) =>
          i.poolKey === item.poolKey ? { ...i, ...item, quantity: q } : i,
        );
      }
      return [...prev, { ...item, quantity: Math.min(quantity, item.available) }];
    });
  }, []);

  const setQuantity = useCallback((poolKey: string, quantity: number) => {
    setItems((prev) =>
      prev
        .map((i) => (i.poolKey === poolKey ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const remove = useCallback((poolKey: string) => {
    setItems((prev) => prev.filter((i) => i.poolKey !== poolKey));
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
